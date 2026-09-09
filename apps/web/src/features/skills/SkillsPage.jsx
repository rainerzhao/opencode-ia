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

export function SkillsPage({initialSkills=null,initialSelectedSkill=null}){
  const[items,setItems]=useState(initialSkills||[]);
  const[selected,setSelected]=useState(initialSelectedSkill);
  const[form,setForm]=useState(formFor(initialSelectedSkill));
  const[files,setFiles]=useState(filesFor(initialSelectedSkill));
  const[busy,setBusy]=useState(false);
  const[notice,setNotice]=useState('');

  useEffect(()=>{
    if(initialSkills!==null)return;
    request('/api/skills').then(body=>setItems(body.skills||[])).catch(error=>setNotice(error.message));
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
    setItems(current=>[summaryFor(skill),...current.filter(item=>item.id!==skill.id)]);
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

  const report=selected?.version?.validationReport;
  const hasReport=report&&Object.keys(report).length>0;
  return <section className="skills-workspace">
    <aside className="panel skill-rail">
      <div className="section-head"><div><p className="eyebrow">Stage 4B</p><h3>私人草稿</h3></div><button onClick={startCreate}>新建 Skill</button></div>
      <p className="muted">草稿仅本人可见，校验并人工发布后才会成为团队资产。</p>
      <div className="skill-list">
        {items.length?items.map(item=><button className={`skill-item ${selected?.id===item.id?'active':''}`} onClick={()=>openDraft(item)} key={item.id} disabled={busy}>
          <strong>{item.displayName}</strong><span>{item.slug}</span><small>v{item.version} · 私人草稿</small>
        </button>):<div className="empty skill-empty">还没有私人 Skill 草稿</div>}
      </div>
    </aside>
    <form className="panel skill-editor" onSubmit={save}>
      <div className="section-head"><div><p className="eyebrow">{selected?'EDIT DRAFT':'NEW DRAFT'}</p><h3>{selected?'编辑 Skill 草稿':'创建 Skill 草稿'}</h3></div>{selected&&<span className="skill-version">v{selected.version.version} · 私人草稿</span>}</div>
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
      <div className="form-actions">{selected&&<button className="ghost danger" type="button" onClick={archive} disabled={busy}>归档</button>}<button className="ghost" type="button" onClick={validateDraft} disabled={busy}>{busy?'处理中…':'开始校验'}</button><button type="submit" disabled={busy}>{busy?'处理中…':'保存草稿'}</button></div>
    </form>
  </section>;
}
