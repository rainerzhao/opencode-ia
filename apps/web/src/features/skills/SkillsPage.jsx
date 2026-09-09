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

export function SkillsPage({initialSkills=null,initialSelectedSkill=null}){
  const[items,setItems]=useState(initialSkills||[]);
  const[selected,setSelected]=useState(initialSelectedSkill);
  const[form,setForm]=useState(formFor(initialSelectedSkill));
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
    setNotice('');
  }

  async function openDraft(item){
    setBusy(true);
    setNotice('');
    try{
      const body=await request(`/api/skills/${encodeURIComponent(item.id)}`);
      setSelected(body.skill);
      setForm(formFor(body.skill));
    }catch(error){setNotice(error.message)}finally{setBusy(false)}
  }

  async function save(event){
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try{
      const editing=Boolean(selected);
      const payload=editing
        ?{displayName:form.displayName,description:form.description,skillMd:form.skillMd}
        :form;
      const body=await request(editing?`/api/skills/${encodeURIComponent(selected.id)}`:'/api/skills',{
        method:editing?'PATCH':'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify(payload)
      });
      const skill=body.skill;
      setSelected(skill);
      setForm(formFor(skill));
      setItems(current=>[summaryFor(skill),...current.filter(item=>item.id!==skill.id)]);
      setNotice(editing?'草稿已保存':'私人草稿已创建');
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
      setNotice('草稿已归档，可从归档列表恢复治理');
    }catch(error){setNotice(error.message)}finally{setBusy(false)}
  }

  return <section className="skills-workspace">
    <aside className="panel skill-rail">
      <div className="section-head"><div><p className="eyebrow">Stage 4A</p><h3>私人草稿</h3></div><button onClick={startCreate}>新建 Skill</button></div>
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
      <p className={`notice ${notice.includes('已')?'success':'error'}`}>{notice}</p>
      <div className="form-actions">{selected&&<button className="ghost danger" type="button" onClick={archive} disabled={busy}>归档</button>}<button type="submit" disabled={busy}>{busy?'处理中…':'保存草稿'}</button></div>
    </form>
  </section>;
}
