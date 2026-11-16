import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocument } from '../src/document/model.ts';
import { embedThumbnail, parseProject, serializeProject } from '../src/document/persistence.ts';

const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
test('a prévia vai no começo do arquivo e o projeto continua abrindo igual', () => {
  const doc = createDocument(); doc.name = 'Prévia';
  const source = serializeProject(doc), withThumb = embedThumbnail(source, JPEG);
  assert.ok(withThumb.startsWith('{"thumbnail":"data:image/jpeg;base64,'), 'o leitor do Explorador procura nos primeiros bytes');
  assert.deepEqual(parseProject(withThumb), parseProject(source));
  assert.equal(embedThumbnail(source, null), source);
  assert.equal(embedThumbnail(source, 'javascript:alert(1)'), source);
});
