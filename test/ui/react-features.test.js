'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const root = path.resolve(__dirname, '../..');

test('gateway operations shows safe metadata and only active jobs offer cancellation', async () => {
  await withViteModule('features/admin/GatewayPanel.jsx', ({ GatewayPanel }) => {
    const html = renderToStaticMarkup(React.createElement(GatewayPanel, {
      initialData: {
        health: { status: 'healthy', running: 1, queued: 0, healthyWorkers: 2 },
        workers: [{ id: 'worker-1', status: 'healthy', capacity: 1, running: 1, password: 'PRIVATE' }],
        jobs: [{ id: 'job-1', userId: 'member-1', status: 'running', inputText: 'PRIVATE' }, { id: 'job-2', status: 'completed' }]
      }
    }));
    assert.match(html, /运行管理/);
    assert.match(html, /服务正常/);
    assert.match(html, /member-1/);
    assert.equal((html.match(/>取消任务</g) || []).length, 1);
    assert.doesNotMatch(html, /PRIVATE/);
  });
});

async function withViteModule(relativePath, callback) {
  const { createServer } = await import('vite');
  const server = await createServer({
    root: path.join(root, 'apps/web'),
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'silent'
  });
  try {
    const module = await server.ssrLoadModule(`/src/${relativePath}`);
    await callback(module);
  } finally {
    await server.close();
  }
}

test('requirement workbench makes private BU work discoverable and recordable', async () => {
  await withViteModule('features/requirements/RequirementsPage.jsx', ({ RequirementsPage }) => {
    const html = renderToStaticMarkup(React.createElement(RequirementsPage, {
      initialRequirements: [{ id: 'req-1', title: '门店网络改造', buName: '零售 BU', status: 'clarifying', updatedAt: '2026-09-14T08:00:00.000Z' }],
      initialBusinessUnits: [{ id: 'bu-1', name: '零售 BU' }],
      initialFieldTemplates: []
    }));
    assert.match(html, /我的需求流/);
    assert.match(html, /默认私有/);
    assert.match(html, /门店网络改造/);
    assert.match(html, /placeholder="搜索需求、场景或沟通背景"/);
    assert.match(html, />新建需求</);
    assert.match(html, /原始沟通记录/);
    assert.match(html, /记录沟通/);
    assert.match(html, /下一步行动/);
  });
});

test('requirement workbench keeps AI drafts private until a member confirms or rejects them', async () => {
  await withViteModule('features/requirements/RequirementsPage.jsx', ({ RequirementsPage }) => {
    const html = renderToStaticMarkup(React.createElement(RequirementsPage, {
      initialRequirements: [], initialBusinessUnits: [{ id: 'bu-1', name: '零售 BU' }], initialFieldTemplates: [],
      initialDrafts: [{ id: 'draft-1', sourceConversationId: 'conversation-1', status: 'ready', draft: { title: '门店网络改造', scenario: '', description: '', fieldValues: [], needsClarification: ['确认 SLA'] } }]
    }));
    assert.match(html, /AI 需求草稿/);
    assert.match(html, /确认并建立私有需求/);
    assert.match(html, /拒绝草稿/);
    assert.match(html, /确认 SLA/);
  });
});

test('requirement draft inbox reconciles generating drafts through its private detail endpoint', async () => {
  await withViteModule('features/requirements/RequirementsPage.jsx', async ({ reconcileDrafts }) => {
    const calls = [];
    const drafts = await reconcileDrafts([
      { id: 'draft-generating', status: 'generating' },
      { id: 'draft-ready', status: 'ready' }
    ], async (pathname) => {
      calls.push(pathname);
      return { draft: { id: 'draft-generating', status: 'ready', draft: { title: '已整理的草稿' } } };
    });
    assert.deepEqual(calls, ['/api/requirements/drafts/draft-generating']);
    assert.equal(drafts[0].status, 'ready');
    assert.equal(drafts[1].status, 'ready');
  });
});

test('requirement detail shows its own linked assets and a controlled linking entry point', async () => {
  await withViteModule('features/requirements/RequirementsPage.jsx', ({ RequirementsPage }) => {
    const html = renderToStaticMarkup(React.createElement(RequirementsPage, {
      initialRequirements: [{ id: 'req-1', title: '门店网络改造', buName: '零售 BU', status: 'draft', updatedAt: '2026-09-14T08:00:00.000Z', links: [{ id: 'link-1', resourceType: 'conversation', resourceId: 'conversation-1', title: '网络沟通' }] }],
      initialBusinessUnits: [], initialFieldTemplates: [], initialDrafts: [],
      initialAssets: { conversations: [{ id: 'conversation-1', title: '网络沟通' }], knowledge: [], solutions: [] }
    }));
    assert.match(html, /关联资产/);
    assert.match(html, /网络沟通/);
    assert.match(html, /关联私有资产/);
  });
});

test('administrator can reach every account recovery control', async () => {
  await withViteModule('features/admin/AdminPage.jsx', ({ AdminPage }) => {
    const html = renderToStaticMarkup(React.createElement(AdminPage, {
      user: { id: 'admin-1' },
      initialUsers: [{
        id: 'member-1',
        username: 'member',
        displayName: 'Team Member',
        role: 'member',
        status: 'active'
      }]
    }));

    assert.match(html, /type="password"/);
    assert.match(html, />重置密码</);
    assert.match(html, />撤销会话</);
    assert.match(html, />停用</);
  });
});

test('administrator can configure the BU and controlled fields that private requirements use', async () => {
  await withViteModule('features/admin/AdminPage.jsx', ({ AdminPage }) => {
    const html = renderToStaticMarkup(React.createElement(AdminPage, {
      user: { id: 'admin-1' }, initialBusinessUnits: [{ id: 'bu-1', name: '零售 BU' }], initialFieldTemplates: [{ id: 'field-1', key: 'priority', label: '优先级', type: 'select', options: ['高'], required: false }]
    }));
    assert.match(html, /需求配置/);
    assert.match(html, /新增业务单元/);
    assert.match(html, /零售 BU/);
    assert.match(html, /新增统一字段/);
    assert.match(html, /优先级/);
  });
});

test('knowledge page exposes search, authoring, and upload workflows', async () => {
  await withViteModule('features/knowledge/KnowledgePage.jsx', ({ KnowledgePage }) => {
    const html = renderToStaticMarkup(React.createElement(KnowledgePage));
    assert.match(html, /placeholder="搜索标题或正文"/);
    assert.match(html, />新建文档</);
    assert.match(html, />上传文件</);
    assert.match(html, /导入知识包/);
  });
});

test('content pages show private state and explicit in-page publish or withdraw controls', async () => {
  await withViteModule('features/knowledge/KnowledgePage.jsx', ({ KnowledgePage }) => {
    const html = renderToStaticMarkup(React.createElement(KnowledgePage, {
      initialItems: [{ id: 'knowledge-1', title: 'GPU 草稿', status: 'draft', visibility: 'private', version: 1 }]
    }));
    assert.match(html, /私有草稿/);
    assert.match(html, />发布到团队</);
  });
  await withViteModule('features/solutions/SolutionsPage.jsx', ({ SolutionsPage }) => {
    const html = renderToStaticMarkup(React.createElement(SolutionsPage, {
      initialItems: [{ id: 'solution-1', title: '团队方案', status: 'published', visibility: 'team', version: 2 }]
    }));
    assert.match(html, /团队已发布/);
    assert.match(html, />撤回团队</);
  });
});

test('content editors expose explicit historical version restore controls', async () => {
  await withViteModule('features/knowledge/KnowledgePage.jsx', ({ KnowledgePage }) => {
    const html = renderToStaticMarkup(React.createElement(KnowledgePage, {
      initialEditor: { id: 'knowledge-1', title: '知识 v2', status: 'draft', visibility: 'private', version: 2, content: '# v2', versionHistory: [{ id: 'v2', version: 2 }, { id: 'v1', version: 1 }] }
    }));
    assert.match(html, />恢复 v1</);
  });
  await withViteModule('features/solutions/SolutionsPage.jsx', ({ SolutionsPage }) => {
    const html = renderToStaticMarkup(React.createElement(SolutionsPage, {
      initialItems: [], initialEditor: { id: 'solution-1', title: '方案 v2', status: 'draft', visibility: 'private', version: 2, solutionMarkdown: '# v2', versionHistory: [{ id: 'v2', version: 2 }, { id: 'v1', version: 1 }] }
    }));
    assert.match(html, />恢复 v1</);
  });
});

test('Skill center exposes private draft creation and editing controls', async () => {
  await withViteModule('features/skills/SkillsPage.jsx', ({ SkillsPage }) => {
    const skill = {
      id: 'skill-1',
      slug: 'gpu-planner',
      displayName: 'GPU 规划助手',
      description: '估算容量',
      status: 'draft',
      visibility: 'private',
      version: {
        version: '0.1.0',
        status: 'draft',
        skillMd: '# GPU Planner'
      }
    };
    const html = renderToStaticMarkup(React.createElement(SkillsPage, {
      initialSkills: [{ ...skill, version: '0.1.0', versionStatus: 'draft' }],
      initialSelectedSkill: skill
    }));

    assert.match(html, /私人草稿/);
    assert.match(html, /GPU 规划助手/);
    assert.match(html, /0\.1\.0/);
    assert.match(html, /SKILL\.md/);
    assert.match(html, />保存草稿</);
    assert.match(html, />归档</);
    assert.match(html, /name="slug"/);
    assert.match(html, /name="displayName"/);
    assert.match(html, /name="description"/);
    assert.match(html, /name="skillMd"/);
  });
});

test('Skill center exposes package files and a private validation report without publishing controls', async () => {
  await withViteModule('features/skills/SkillsPage.jsx', ({ SkillsPage }) => {
    const skill = {
      id: 'skill-validation',
      slug: 'gpu-planner',
      displayName: 'GPU 规划助手',
      description: '估算容量',
      status: 'draft',
      visibility: 'private',
      files: [{
        id: 'file-1',
        path: 'references/guide.md',
        content: '# Guide',
        sizeBytes: 7
      }],
      version: {
        version: '0.1.0',
        status: 'draft',
        skillMd: '# GPU Planner',
        validationReport: {
          schemaVersion: 1,
          verdict: 'fail',
          summary: { errors: 1, warnings: 0, files: 2, totalBytes: 20 },
          checks: [{
            id: 'frontmatter',
            status: 'fail',
            severity: 'error',
            message: 'frontmatter must contain unique name and description fields',
            findings: []
          }],
          runtime: { status: 'skipped', provider: 'opencode-gateway' }
        }
      }
    };
    const html = renderToStaticMarkup(React.createElement(SkillsPage, {
      initialSkills: [{ ...skill, version: '0.1.0', versionStatus: 'draft' }],
      initialSelectedSkill: skill
    }));

    assert.match(html, /附加文件/);
    assert.match(html, /references\/guide\.md/);
    assert.match(html, /新增文件/);
    assert.match(html, /开始校验/);
    assert.match(html, /校验未通过/);
    assert.match(html, /OpenCode 运行门禁：已跳过/);
    assert.match(html, /frontmatter must contain unique name/);
    assert.match(html, /私人草稿/);
    assert.doesNotMatch(html, />发布</);
  });
});

test('Skill center separates private drafts from the team catalog and exposes publish, install and enable actions', async () => {
  await withViteModule('features/skills/SkillsPage.jsx', ({ SkillsPage }) => {
    const validated = {
      id: 'private-validated', slug: 'private-validated', displayName: 'Private Validated',
      status: 'draft', visibility: 'private', files: [],
      version: {
        id: 'version-private', version: '0.1.0', status: 'validated', skillMd: '# Private',
        validationReport: {
          verdict: 'pass', contentSha256: 'a'.repeat(64), checks: [],
          summary: { errors: 0, warnings: 0 }, runtime: { status: 'passed' }
        }
      }
    };
    const published = {
      id: 'team-published', slug: 'team-published', displayName: 'Team Published',
      description: 'Shared team capability', status: 'published', visibility: 'team',
      version: '0.1.0', versionStatus: 'published'
    };
    const html = renderToStaticMarkup(React.createElement(SkillsPage, {
      initialSkills: [{ ...validated, version: '0.1.0', versionStatus: 'validated' }],
      initialSelectedSkill: validated,
      initialTeamSkills: [published],
      initialInstallations: [{ skillId: published.id, status: 'installed' }]
    }));

    assert.match(html, /发布到团队/);
    assert.match(html, /团队已发布/);
    assert.match(html, /Team Published/);
    assert.match(html, />已安装</);
    assert.match(html, />启用</);
    assert.match(html, /发布后不可修改/);
  });
});

test('Skill center exposes version governance without treating a disabled Skill as runnable', async () => {
  await withViteModule('features/skills/SkillsPage.jsx', ({ SkillsPage }) => {
    const active = {
      id: 'governed-skill', ownerUserId: 'owner-ui', slug: 'governed-skill', displayName: 'Governed Skill',
      description: 'Can evolve safely', status: 'published', visibility: 'team', version: '0.2.0', versionStatus: 'published'
    };
    const disabled = {
      id: 'disabled-skill', ownerUserId: 'owner-ui', slug: 'disabled-skill', displayName: 'Disabled Skill',
      status: 'disabled', visibility: 'team', version: '0.1.0', versionStatus: 'published'
    };
    const html = renderToStaticMarkup(React.createElement(SkillsPage, {
      currentUser: { id: 'owner-ui', role: 'member' }, initialSkills: [], initialTeamSkills: [active, disabled],
      initialInstallations: [{ skillId: active.id, versionId: 'version-1', status: 'enabled' }],
      initialReleaseVersions: {
        [active.id]: [
          { id: 'version-2', version: '0.2.0', status: 'published' },
          { id: 'version-1', version: '0.1.0', status: 'retired' }
        ]
      }
    }));

    assert.match(html, /创建新版本/);
    assert.match(html, /可用版本/);
    assert.match(html, /升级到 v0.2.0/);
    assert.match(html, /v0.1.0 · retired/);
    assert.match(html, /停用团队 Skill/);
    assert.match(html, /团队已停用/);
    assert.doesNotMatch(html, /Disabled Skill[\s\S]*>启用</);
  });
});

test('editing an existing knowledge article keeps its title in submitted form data', async () => {
  await withViteModule('features/knowledge/KnowledgePage.jsx', ({ KnowledgePage }) => {
    const html = renderToStaticMarkup(React.createElement(KnowledgePage, {
      initialEditor: { path: 'notes/example.md', title: 'example', content: '# example', isNew: false }
    }));
    const titleInput = html.match(/<input[^>]*name="title"[^>]*>/)?.[0];
    assert.ok(titleInput, 'title input should remain part of the edit form');
    assert.match(titleInput, /readOnly=""/);
    assert.doesNotMatch(titleInput, /disabled/);
  });
});

test('knowledge editor exposes attachment preview controls for supported text files', async () => {
  await withViteModule('features/knowledge/KnowledgePage.jsx', ({ KnowledgePage }) => {
    const html = renderToStaticMarkup(React.createElement(KnowledgePage, {
      initialEditor: {
        id: 'knowledge-preview',
        title: '带附件的知识',
        markdown: '# 内容',
        content: '# 内容',
        version: 2,
        isNew: false,
        versionHistory: [{ id: 'version-2', version: 2 }, { id: 'version-1', version: 1 }],
        attachments: [{
          id: 'attachment-1',
          originalName: 'guide.md',
          sizeBytes: 12,
          contentSha256: 'a'.repeat(64)
        }]
      }
    }));
    assert.match(html, /guide\.md/);
    assert.match(html, />预览</);
    assert.match(html, /导出知识包/);
    assert.match(html, /\/api\/content\/knowledge\/knowledge-preview\/export/);
    assert.match(html, /对比 v1 → 当前 v2/);
    assert.match(html, /input type="file"/);
  });
});

test('a conversation can be explicitly saved as a private solution', async () => {
  await withViteModule('features/chat/ChatPage.jsx', ({ ChatPage }) => {
    const html = renderToStaticMarkup(React.createElement(ChatPage, {
      initialMessages: [{ role: 'assistant', text: 'A reviewed answer' }]
    }));
    assert.match(html, />沉淀为方案</);
    assert.match(html, /默认仅本人可见/);
  });
});

test('chat page exposes private conversation navigation and running controls', async () => {
  await withViteModule('features/chat/ChatPage.jsx', ({ ChatPage }) => {
    const html = renderToStaticMarkup(React.createElement(ChatPage, {
      initialConversations: [
        { id: 'conversation-1', title: '季度预算分析', status: 'active' },
        { id: 'conversation-2', title: '客户方案复盘', status: 'active' }
      ],
      initialActiveConversationId: 'conversation-1',
      initialExecutionStatus: 'running',
      initialActiveJobId: 'job-1',
      initialConnection: 'connected'
    }));

    assert.match(html, />新建对话</);
    assert.match(html, />季度预算分析</);
    assert.match(html, />客户方案复盘</);
    assert.match(html, />正在运行</);
    assert.match(html, />停止任务</);
  });
});

test('chat can explicitly request a private requirement draft from bounded conversation events', async () => {
  await withViteModule('features/chat/ChatPage.jsx', ({ ChatPage }) => {
    const html = renderToStaticMarkup(React.createElement(ChatPage, {
      initialConversations: [{ id: 'conversation-1', title: '门店网络沟通' }],
      initialActiveConversationId: 'conversation-1',
      initialMessages: [{ id: 'message-1', role: 'assistant', text: '已记录约束' }],
      initialConnection: 'connected'
    }));
    assert.match(html, /生成需求草稿/);
    assert.match(html, /仅使用当前对话中明确选择的事件范围/);
    assert.match(html, /AI 不会自动创建或公开需求/);
  });
});

test('chat event reducer rebuilds private message history and execution state', async () => {
  await withViteModule('features/chat/ChatPage.jsx', ({ applyGatewayEvent }) => {
    let state = { messages: [], status: 'idle', cursor: 0, activeJobId: null, recoveryBoundary: false };
    state = applyGatewayEvent(state, {
      type: 'message.created', jobId: 'job-1', sequence: 1,
      data: { role: 'user', text: '请分析预算' }
    });
    state = applyGatewayEvent(state, {
      type: 'job.started', jobId: 'job-1', sequence: 3, data: { status: 'running' }
    });
    state = applyGatewayEvent(state, {
      type: 'message.delta', jobId: 'job-1', sequence: 4, data: { text: '结论一' }
    });
    state = applyGatewayEvent(state, {
      type: 'message.delta', jobId: 'job-1', sequence: 5, data: { text: '；结论二' }
    });
    state = applyGatewayEvent(state, {
      type: 'job.completed', jobId: 'job-1', sequence: 6, data: { status: 'completed' }
    });

    assert.deepEqual(state.messages, [
      { id: 'job-1:user', role: 'user', text: '请分析预算' },
      { id: 'job-1:assistant', role: 'assistant', text: '结论一；结论二' }
    ]);
    assert.equal(state.status, 'completed');
    assert.equal(state.cursor, 6);
    assert.equal(state.activeJobId, null);
    state = applyGatewayEvent(state, {
      type: 'conversation.recovery_boundary', sequence: 7, data: {}
    });
    assert.equal(state.recoveryBoundary, true);
    assert.equal(state.messages.length, 2);
  });
});

test('recovery boundary tells the user that uncertain work is not silently replayed', async () => {
  await withViteModule('features/chat/ChatPage.jsx', ({ ChatPage }) => {
    const html = renderToStaticMarkup(React.createElement(ChatPage, {
      initialConversations: [{ id: 'conversation-1', title: '恢复测试', status: 'active' }],
      initialActiveConversationId: 'conversation-1',
      initialMessages: [],
      initialExecutionStatus: 'interrupted'
    }));
    assert.match(html, /不会自动重放/);
    assert.match(html, /确认上下文后重新发送/);
  });
});
