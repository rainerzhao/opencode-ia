import React,{useEffect,useState}from'react';
import{request}from'../../api/client';

const emptyDraft={slug:'',displayName:'',description:'',skillMd:''};

function formFor(skill){
  if(!skill)return{...emptyDraft};
  return{
    slug:skill.slug||'',
    displayName:skill.displayName||'',
    description:skill.description||'',
    skillMd:skill.version?.skillMd||''
  };
}

function filesFor(skill){
  return(skill?.files||[]).map(file=>({path:file.path||'',content:file.content||''}));
}

function summaryFor(skill){
  return{
    id:skill.id,
    ownerUserId:skill.ownerUserId,
    slug:skill.slug,
    displayName:skill.displayName,
    description:skill.description,
    status:skill.status,
    visibility:skill.visibility,
    version:skill.version?.version||skill.version,
    versionStatus:skill.version?.status||skill.versionStatus,
    createdAt:skill.createdAt,
    updatedAt:skill.updatedAt
  };
}

function runtimeStatusLabel(status){
  return({
    passed:'已通过',
    failed:'未通过',
    skipped:'已跳过',
    unavailable:'暂不可用',
    not_run:'未运行'
  })[status]||'未知';
}

export function SkillsPage({currentUser=null,initialSkills=null,initialSelectedSkill=null,initialTeamSkills=null,initialInstallations=null,initialReleaseVersions=null}){
  const[items,setItems]=useState(initialSkills||[]);
  const[teamItems,setTeamItems]=useState(initialTeamSkills||[]);
  const[installations,setInstallations]=useState(initialInstallations||[]);
  const[releaseVersions,setReleaseVersions]=useState(initialReleaseVersions||{});
  const[selected,setSelected]=useState(initialSelectedSkill);
  const[form,setForm]=useState(formFor(initialSelectedSkill));
  const[files,setFiles]=useState(filesFor(initialSelectedSkill));
  const[busy,setBusy]=useState(false);
  const[notice,setNotice]=useState('');

  useEffect(()=>{
    if(initialSkills!==null)return;
    Promise.all([
      request('/api/skills'),
      request('/api/skills?status=published'),
      request('/api/skills/installations')
    ]).then(([privateBody,teamBody,installationBody])=>{
      setItems(privateBody.skills||[]);
      setTeamItems(teamBody.skills||[]);
      setInstallations(installationBody.installations||[]);
    }).catch(error=>setNotice(error.message));
  },[initialSkills]);

  function change(event){
    setForm(current=>({...current,[event.target.name]:event.target.value}));
  }

  function startCreate(){
    setSelected(null);
    setForm({...emptyDraft});
    setFiles([]);
    setNotice('');
  }

  async function openDraft(item){
    setBusy(true);
    setNotice('');
    try{
      const body=await request(`/api/skills/${encodeURIComponent(item.id)}`);
      setSelected(body.skill);
      setForm(formFor(body.skill));
      setFiles(filesFor(body.skill));
    }catch(error){setNotice(error.message)}finally{setBusy(false)}
  }

  function adoptSkill(skill){
    setSelected(skill);
    setForm(formFor(skill));
    setFiles(filesFor(skill));
    if(skill.status==='draft')setItems(current=>[summaryFor(skill),...current.filter(item=>item.id!==skill.id)]);
  }

  async function persistDraft(){
    const editing=Boolean(selected);
    const payload=editing
      ?{displayName:form.displayName,description:form.description,skillMd:form.skillMd}
      :form;
    const body=await request(editing?`/api/skills/${encodeURIComponent(selected.id)}`:'/api/skills',{
      method:editing?'PATCH':'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(payload)
    });
    let skill=body.skill;
    adoptSkill(skill);
    const fileBody=await request(`/api/skills/${encodeURIComponent(skill.id)}/files`,{
      method:'PUT',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({files})
    });
    skill=fileBody.skill;
    adoptSkill(skill);
    return{skill,editing};
  }

  async function save(event){
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try{
      const{editing}=await persistDraft();
      setNotice(editing?'草稿已保存':'私人草稿已创建');
    }catch(error){setNotice(error.message)}finally{setBusy(false)}
  }

  function addFile(){
    setFiles(current=>[...current,{path:'',content:''}]);
  }

  function changeFile(index,field,value){
    setFiles(current=>current.map((file,fileIndex)=>fileIndex===index?{...file,[field]:value}:file));
  }

  function removeFile(index){
    setFiles(current=>current.filter((_,fileIndex)=>fileIndex!==index));
  }

  async function validateDraft(){
    setBusy(true);
    setNotice('');
    try{
      const{skill}=await persistDraft();
      const body=await request(`/api/skills/${encodeURIComponent(skill.id)}/validate`,{method:'POST'});
      adoptSkill(body.skill);
      setNotice(body.skill.version.validationReport.verdict==='pass'?'校验已通过':'校验未通过');
    }catch(error){setNotice(error.message)}finally{setBusy(false)}
  }

  async function archive(){
    if(!selected)return;
    setBusy(true);
    setNotice('');
    try{
      await request(`/api/skills/${encodeURIComponent(selected.id)}`,{method:'DELETE'});
      setItems(current=>current.filter(item=>item.id!==selected.id));
      setSelected(null);
      setForm({...emptyDraft});
      setFiles([]);
      setNotice('草稿已归档，可从归档列表恢复治理');
    }catch(error){setNotice(error.message)}finally{setBusy(false)}
  }

  async function publish(){
    if(!selected)return;
    const confirmed=typeof window==='undefined'||window.confirm('发布后该版本不可修改，团队成员可自行安装。确认发布到团队？');
    if(!confirmed)return;
    setBusy(true);
    setNotice('');
    try{
      const body=await request(`/api/skills/${encodeURIComponent(selected.id)}/publish`,{method:'POST'});
      setItems(current=>current.filter(item=>item.id!==body.skill.id));
      setTeamItems(current=>[summaryFor(body.skill),...current.filter(item=>item.id!==body.skill.id)]);
      setSelected(null);
      setForm({...emptyDraft});
      setFiles([]);
      setNotice('已发布到团队；成员仍需各自安装并启用。');
    }catch(error){setNotice(error.message)}finally{setBusy(false)}
  }

  async function install(skill){
    setBusy(true);
    setNotice('');
    try{
      const body=await request(`/api/skills/${encodeURIComponent(skill.id)}/install`,{method:'POST'});
      setInstallations(current=>[body.installation,...current.filter(item=>item.skillId!==body.installation.skillId)]);
      setNotice(`已安装 ${skill.displayName}；启用后才会进入你的 OpenCode 会话。`);
    }catch(error){setNotice(error.message)}finally{setBusy(false)}
  }

  async function enable(skill){
    setBusy(true);
    setNotice('');
    try{
      const body=await request(`/api/skills/${encodeURIComponent(skill.id)}/enable`,{method:'POST'});
      setInstallations(current=>[body.installation,...current.filter(item=>item.skillId!==body.installation.skillId)]);
      setNotice(`已启用 ${skill.displayName}；仅影响你的 OpenCode 会话。`);
    }catch(error){setNotice(error.message)}finally{setBusy(false)}
  }

  async function createSuccessor(skill){
    setBusy(true);
    setNotice('');
    try{
      const body=await request(`/api/skills/${encodeURIComponent(skill.id)}/versions`,{method:'POST'});
      setSelected(body.skill);
      setForm(formFor(body.skill));
      setFiles(filesFor(body.skill));
      setNotice(`已创建 v${body.skill.version.version} 私人版本草稿；当前团队版本继续可用。`);
    }catch(error){setNotice(error.message)}finally{setBusy(false)}
  }

  async function loadVersions(skill){
    setBusy(true);
    setNotice('');
    try{
      const body=await request(`/api/skills/${encodeURIComponent(skill.id)}/versions`);
      setReleaseVersions(current=>({...current,[skill.id]:body.versions||[]}));
    }catch(error){setNotice(error.message)}finally{setBusy(false)}
  }

  async function changeVersion(skill,version,operation){
    setBusy(true);
    setNotice('');
    try{
      const body=await request(`/api/skills/${encodeURIComponent(skill.id)}/${operation}`,{
        method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({versionId:version.id})
      });
      setInstallations(current=>[body.installation,...current.filter(item=>item.skillId!==body.installation.skillId)]);
      setNotice(`${operation==='upgrade'?'已升级':'已回滚'}到 v${version.version}；需再次通过 OpenCode 验证后启用。`);
    }catch(error){setNotice(error.message)}finally{setBusy(false)}
  }

  async function disableTeamSkill(skill){
    setBusy(true);
    setNotice('');
    try{
      const body=await request(`/api/skills/${encodeURIComponent(skill.id)}/disable`,{method:'POST'});
      setTeamItems(current=>current.map(item=>item.id===skill.id?summaryFor(body.skill):item));
      setInstallations(current=>current.map(item=>item.skillId===skill.id?{...item,status:'disabled'}:item));
      setNotice('团队 Skill 已停用；成员工作区下次准备时将安全移除。');
    }catch(error){setNotice(error.message)}finally{setBusy(false)}
  }

  async function archiveTeamSkill(skill){
    setBusy(true);
    setNotice('');
    try{
      await request(`/api/skills/${encodeURIComponent(skill.id)}/archive`,{method:'POST'});
      setTeamItems(current=>current.filter(item=>item.id!==skill.id));
      setNotice('团队 Skill 已归档，版本与审计记录均被保留。');
    }catch(error){setNotice(error.message)}finally{setBusy(false)}
  }

  const report=selected?.version?.validationReport;
  const hasReport=report&&Object.keys(report).length>0;
  const publishable=Boolean(selected&&['draft','published'].includes(selected.status)&&selected.version?.status==='validated'&&
    report?.verdict==='pass'&&report?.runtime?.status==='passed');
  const installationBySkill=new Map(installations.map(item=>[item.skillId,item]));
  return <section className="skills-workspace">
    <aside className="panel skill-rail">
      <div className="section-head"><div><p className="eyebrow">Stage 4D</p><h3>私人草稿</h3></div><button onClick={startCreate}>新建 Skill</button></div>
      <p className="muted">草稿仅本人可见，校验并人工发布后才会成为团队资产。</p>
      <div className="skill-list">
        {items.length?items.map(item=><button className={`skill-item ${selected?.id===item.id?'active':''}`} onClick={()=>openDraft(item)} key={item.id} disabled={busy}>
          <strong>{item.displayName}</strong><span>{item.slug}</span><small>v{item.version} · 私人草稿</small>
        </button>):<div className="empty skill-empty">还没有私人 Skill 草稿</div>}
      </div>
      <section className="team-catalog">
        <div className="section-head"><div><p className="eyebrow">TEAM CATALOG</p><h4>团队已发布</h4></div></div>
        <p className="muted">发布后不可修改；成员可自主升级或回滚。安装与启用只影响当前账号。</p>
        <div className="team-skill-list">{teamItems.length?teamItems.map(skill=>{
          const installation=installationBySkill.get(skill.id);
          const versions=releaseVersions[skill.id]||[];
          const canGovern=currentUser&&(currentUser.role==='admin'||currentUser.id===skill.ownerUserId);
          const disabled=skill.status==='disabled';
          return <article className="team-skill" key={skill.id}><div><strong>{skill.displayName}</strong><span>{skill.slug} · v{skill.version}</span><p>{skill.description||'团队可复用 Skill'}</p>{versions.length>0&&<div className="release-list"><strong>可用版本</strong>{versions.map(version=><span className="release-option" key={version.id}>v{version.version} · {version.status}{!disabled&&installation?.versionId!==version.id&&version.status==='published'&&<button type="button" onClick={()=>changeVersion(skill,version,'upgrade')} disabled={busy}>升级到 v{version.version}</button>}{!disabled&&installation?.versionId!==version.id&&version.status==='retired'&&<button type="button" onClick={()=>changeVersion(skill,version,'rollback')} disabled={busy}>回滚到 v{version.version}</button>}</span>)}</div>}</div><div className="team-skill-actions">{disabled?<strong className="installed-label">团队已停用</strong>:!installation?<button type="button" onClick={()=>install(skill)} disabled={busy}>安装</button>:installation.status==='enabled'?<strong className="enabled-label">已启用</strong>:installation.status==='disabled'?<strong className="installed-label">已停用</strong>:<><strong className="installed-label">已安装</strong><button type="button" onClick={()=>enable(skill)} disabled={busy}>启用</button></>} {!disabled&&<button className="ghost" type="button" onClick={()=>loadVersions(skill)} disabled={busy}>查看版本</button>}{canGovern&&!disabled&&<><button className="ghost" type="button" onClick={()=>createSuccessor(skill)} disabled={busy}>创建新版本</button><button className="ghost danger" type="button" onClick={()=>disableTeamSkill(skill)} disabled={busy}>停用团队 Skill</button></>}{canGovern&&disabled&&<button className="ghost danger" type="button" onClick={()=>archiveTeamSkill(skill)} disabled={busy}>归档团队 Skill</button>}</div></article>;
        }):<p className="empty compact">暂无团队已发布 Skill</p>}</div>
      </section>
    </aside>
    <form className="panel skill-editor" onSubmit={save}>
      <div className="section-head"><div><p className="eyebrow">{selected?'EDIT DRAFT':'NEW DRAFT'}</p><h3>{selected?'编辑 Skill 草稿':'创建 Skill 草稿'}</h3></div>{selected&&<span className="skill-version">v{selected.version.version} · 私人版本草稿</span>}</div>
      <div className="skill-fields">
        <label>唯一标识<input name="slug" value={form.slug} onChange={change} readOnly={Boolean(selected)} placeholder="gpu-planner" required/></label>
        <label>显示名称<input name="displayName" value={form.displayName} onChange={change} placeholder="GPU 规划助手" required/></label>
        <label className="skill-field-wide">简介<textarea name="description" value={form.description} onChange={change} placeholder="说明这个 Skill 解决什么问题"/></label>
        <label className="skill-field-wide">SKILL.md<textarea className="skill-source" name="skillMd" value={form.skillMd} onChange={change} placeholder={'---\nname: gpu-planner\ndescription: ...\n---\n\n# Instructions'} required/></label>
      </div>
      <section className="skill-package">
        <div className="section-head"><div><h4>附加文件</h4><p className="muted">仅限受控 UTF-8 文本；保存后仍是私人草稿。</p></div><button className="ghost" type="button" onClick={addFile} disabled={busy}>新增文件</button></div>
        <div className="skill-file-list">
          {files.length?files.map((file,index)=><article className="skill-file" key={`${index}-${file.path}`}>
            <label>相对路径<input value={file.path} onChange={event=>changeFile(index,'path',event.target.value)} placeholder="references/guide.md" required/></label>
            <label>文件内容<textarea value={file.content} onChange={event=>changeFile(index,'content',event.target.value)} placeholder="# Guide"/></label>
            <button className="ghost danger" type="button" onClick={()=>removeFile(index)} disabled={busy}>移除文件</button>
          </article>):<p className="empty compact">没有附加文件，SKILL.md 仍可单独校验。</p>}
        </div>
      </section>
      <section className={`skill-validation ${hasReport?report.verdict:'pending'}`}>
        <div className="section-head"><div><p className="eyebrow">VALIDATION</p><h4>{!hasReport?'尚未校验':report.verdict==='pass'?'校验已通过':'校验未通过'}</h4></div>{hasReport&&<strong>{report.summary.errors} 错误 · {report.summary.warnings} 警告</strong>}</div>
        <p className="muted">结构与安全检查通过后，还必须经过受限 OpenCode Runtime；校验不等于发布。</p>
        {hasReport&&<div className="validation-checks">{report.checks.map(item=><article className={item.status} key={item.id}><span>{item.status==='pass'?'通过':'失败'}</span><div><strong>{item.id}</strong><p>{item.message}</p></div></article>)}</div>}
        {hasReport&&<p className="runtime-state">OpenCode 运行门禁：{runtimeStatusLabel(report.runtime.status)}</p>}
      </section>
      <p className={`notice ${notice.includes('已')?'success':'error'}`}>{notice}</p>
      <div className="form-actions">{selected?.status==='draft'&&<button className="ghost danger" type="button" onClick={archive} disabled={busy}>归档</button>}{publishable&&<button className="publish" type="button" onClick={publish} disabled={busy}>发布到团队</button>}<button className="ghost" type="button" onClick={validateDraft} disabled={busy}>{busy?'处理中…':'开始校验'}</button><button type="submit" disabled={busy}>{busy?'处理中…':'保存草稿'}</button></div>
    </form>
  </section>;
}
