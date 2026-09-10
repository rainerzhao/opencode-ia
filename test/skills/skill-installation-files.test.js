'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createSkillInstallationFiles } = require('../../src/skills/skill-installation-files');
const { createSkillWorkspaceSync } = require('../../src/skills/skill-workspace-sync');

function digest(skillMd, files) {
  const hash = crypto.createHash('sha256').update(skillMd);
  for (const file of files) hash.update('\0').update(file.path).update('\0')
    .update(String(Buffer.byteLength(file.content, 'utf8'))).update('\0').update(file.content);
  return hash.digest('hex');
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-installation-files-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, installRoot: path.join(root, 'installations'), workspace: path.join(root, 'workspace') };
}

function packageFixture({ userId = 'member-1', skillId = 'skill-1', versionId = 'version-1', slug = 'team-helper' } = {}) {
  const skillMd = `---\nname: ${slug}\ndescription: Team helper\n---\n\n# Instructions\n`;
  const files = [{ path: 'references/guide.md', content: '# Guide\n' }];
  return {
    userId,
    skill: {
      id: skillId,
      slug,
      version: { id: versionId, skillMd, contentSha256: digest(skillMd, files) },
      files
    }
  };
}

test('writes an immutable user-owned Skill package with a verified manifest and restrictive permissions', (t) => {
  const { installRoot } = fixture(t);
  const files = createSkillInstallationFiles({ root: installRoot });
  const input = packageFixture();

  const directory = files.writePackage(input);
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, '.workbench-install.json'), 'utf8'));

  assert.equal(directory, path.join(installRoot, 'member-1', 'team-helper'));
  assert.equal(fs.readFileSync(path.join(directory, 'SKILL.md'), 'utf8'), input.skill.version.skillMd);
  assert.equal(fs.readFileSync(path.join(directory, 'references', 'guide.md'), 'utf8'), '# Guide\n');
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    userId: 'member-1',
    skillId: 'skill-1',
    versionId: 'version-1',
    slug: 'team-helper',
    contentSha256: input.skill.version.contentSha256
  });
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(directory, 'SKILL.md')).mode & 0o777, 0o600);
  assert.equal(files.readPackage({ userId: input.userId, slug: input.skill.slug }).contentSha256,
    input.skill.version.contentSha256);
});

test('does not replace a prior package when a write fails or a symlink is introduced', (t) => {
  const { installRoot } = fixture(t);
  const files = createSkillInstallationFiles({ root: installRoot });
  const input = packageFixture();
  const first = files.writePackage(input);
  const original = fs.readFileSync(path.join(first, 'SKILL.md'), 'utf8');

  assert.throws(() => files.writePackage({
    ...input,
    skill: { ...input.skill, files: [{ path: '../escape.md', content: 'no' }] }
  }), /skill package/i);
  assert.equal(fs.readFileSync(path.join(first, 'SKILL.md'), 'utf8'), original);

  fs.rmSync(first, { recursive: true, force: true });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-install-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.mkdirSync(path.join(installRoot, 'member-1'), { recursive: true });
  fs.symlinkSync(outside, path.join(installRoot, 'member-1', 'team-helper'));
  assert.throws(() => files.readPackage({ userId: 'member-1', slug: 'team-helper' }), /skill package/i);
});

test('atomically materializes only a user enabled Skill set into a Conversation workspace', (t) => {
  const { installRoot, workspace } = fixture(t);
  const files = createSkillInstallationFiles({ root: installRoot });
  const memberOne = packageFixture({ userId: 'member-1', slug: 'member-one' });
  const memberTwo = packageFixture({ userId: 'member-2', skillId: 'skill-2', versionId: 'version-2', slug: 'member-two' });
  files.writePackage(memberOne);
  files.writePackage(memberTwo);
  fs.mkdirSync(path.join(workspace, '.opencode', 'skills', 'old-skill'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.opencode', 'skills', 'old-skill', 'SKILL.md'), '# Old');

  const sync = createSkillWorkspaceSync({ installationFiles: files });
  sync.syncEnabledSkills({
    userId: 'member-1',
    directory: workspace,
    installations: [{ skillId: memberOne.skill.id, versionId: memberOne.skill.version.id, slug: memberOne.skill.slug }]
  });

  assert.equal(fs.existsSync(path.join(workspace, '.opencode', 'skills', 'old-skill')), false);
  assert.equal(fs.readFileSync(path.join(workspace, '.opencode', 'skills', 'member-one', 'SKILL.md'), 'utf8'), memberOne.skill.version.skillMd);
  assert.equal(fs.existsSync(path.join(workspace, '.opencode', 'skills', 'member-two')), false);
  assert.equal(fs.statSync(path.join(workspace, '.opencode', 'skills')).mode & 0o777, 0o700);
});

test('rejects digest drift without changing the prior workspace Skill set', (t) => {
  const { installRoot, workspace } = fixture(t);
  const files = createSkillInstallationFiles({ root: installRoot });
  const input = packageFixture();
  files.writePackage(input);
  fs.mkdirSync(path.join(workspace, '.opencode', 'skills', 'stable'), { recursive: true });
  fs.writeFileSync(path.join(workspace, '.opencode', 'skills', 'stable', 'SKILL.md'), '# Stable');
  fs.writeFileSync(path.join(installRoot, 'member-1', 'team-helper', 'SKILL.md'), '# Drift');

  const sync = createSkillWorkspaceSync({ installationFiles: files });
  assert.throws(() => sync.syncEnabledSkills({
    userId: 'member-1', directory: workspace,
    installations: [{ skillId: input.skill.id, versionId: input.skill.version.id, slug: input.skill.slug }]
  }), /skill package/i);
  assert.equal(fs.readFileSync(path.join(workspace, '.opencode', 'skills', 'stable', 'SKILL.md'), 'utf8'), '# Stable');
});
