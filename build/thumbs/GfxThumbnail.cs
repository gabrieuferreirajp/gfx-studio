// Miniatura dos projetos do GFX Studio (.gfxs / .vectorstudio) no Explorador do Windows.
// O GFX Studio grava no início do arquivo uma prévia em JPEG ("thumbnail": "data:image/jpeg;base64,..."); este
// provedor (IThumbnailProvider) só lê essa prévia e a entrega ao Windows. Arquivo sem prévia: o Windows mostra o ícone.
// Compilar: node scripts/build-thumbnail.mjs (csc do .NET Framework 4, que já vem no Windows).
using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]
[assembly: System.Reflection.AssemblyTitle("GFX Studio - miniaturas")]

namespace GfxThumbnail
{
    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("b824b49d-22ac-4161-ac8a-9916e8fa3f7f")]
    public interface IInitializeWithStream { void Initialize(IStream stream, uint mode); }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("e357fccd-a995-4576-b01f-234630154e96")]
    public interface IThumbnailProvider { void GetThumbnail(uint cx, out IntPtr bitmap, out uint alpha); }

    [ComVisible(true), Guid("361a5dd4-1f6c-4336-9e32-cd4d9f01174c"), ClassInterface(ClassInterfaceType.None)]
    public class Provider : IInitializeWithStream, IThumbnailProvider
    {
        // A prévia fica no começo do arquivo; 2 MB bastam com folga.
        const int Limit = 2 * 1024 * 1024;
        byte[] head = new byte[0];

        public void Initialize(IStream stream, uint mode)
        {
            var buffer = new byte[Limit];
            int total = 0;
            IntPtr read = Marshal.AllocHGlobal(sizeof(int));
            try
            {
                while (total < Limit)
                {
                    var chunk = new byte[Math.Min(65536, Limit - total)];
                    stream.Read(chunk, chunk.Length, read);
                    int n = Marshal.ReadInt32(read);
                    if (n <= 0) break;
                    Buffer.BlockCopy(chunk, 0, buffer, total, n);
                    total += n;
                }
            }
            finally { Marshal.FreeHGlobal(read); Marshal.ReleaseComObject(stream); }
            head = new byte[total];
            Buffer.BlockCopy(buffer, 0, head, 0, total);
        }

        /// <summary>Bytes da imagem gravada em "thumbnail" no começo do JSON, ou null.</summary>
        public static byte[] Extract(byte[] data)
        {
            string text = Encoding.ASCII.GetString(data, 0, Math.Min(data.Length, Limit));
            int key = text.IndexOf("\"thumbnail\":\"data:image/", StringComparison.Ordinal);
            if (key < 0 || key > 64) return null;
            int start = text.IndexOf(";base64,", key, StringComparison.Ordinal);
            if (start < 0) return null;
            start += 8;
            int end = text.IndexOf('"', start);
            if (end < 0) return null;
            try { return Convert.FromBase64String(text.Substring(start, end - start)); } catch (FormatException) { return null; }
        }

        public void GetThumbnail(uint cx, out IntPtr bitmap, out uint alpha)
        {
            bitmap = IntPtr.Zero; alpha = 0;
            byte[] bytes = Extract(head);
            if (bytes == null) throw new COMException("Sem prévia", unchecked((int)0x80004005));
            using (var source = Image.FromStream(new MemoryStream(bytes)))
            {
                double k = Math.Min(1.0 * cx / source.Width, 1.0 * cx / source.Height);
                int w = Math.Max(1, (int)Math.Round(source.Width * k)), h = Math.Max(1, (int)Math.Round(source.Height * k));
                using (var result = new Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
                {
                    using (var g = Graphics.FromImage(result))
                    {
                        g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                        g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                        g.Clear(Color.White);
                        g.DrawImage(source, 0, 0, w, h);
                    }
                    bitmap = result.GetHbitmap();
                    alpha = 1; // WTSAT_RGB: prévia opaca (fundo branco)
                }
            }
        }
    }
}
