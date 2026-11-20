    (() => {
      'use strict';
      const $ = (sel) => document.querySelector(sel);
      const $$ = (sel) => [...document.querySelectorAll(sel)];
      const state = { token: sessionStorage.getItem('sc_token') || '', user: null, groups: [], myGroups: [], topics: [], levels: [], currentGroup: null, currentTab: 'chat', currentConversation: null, authMode: 'login', page: 'explore' };
      let toastTimer = null;
      function escapeHTML(value) { return String(value ?? '').replace(/[&<>"']/g, (ch) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
      function initials(value) { return String(value || 'S').trim().split(/\s+/).slice(0,2).map(x => x[0] || '').join('').toUpperCase() || 'S'; }
      function toast(message, error=false) { const el=$('#toast'); el.textContent=message; el.classList.toggle('error',error); el.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.add('hidden'),3800); }
      async function api(path, options={}) {
        const headers = { ...(options.headers || {}) };
        if (state.token) headers.Authorization = `Bearer ${state.token}`;
        if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
        let response;
        try { response = await fetch(path, { ...options, headers }); }
        catch { throw new Error('Cannot reach the Node.js server. Open http://localhost:3000 and check that npm start is running.'); }
        const data = await response.json().catch(()=>({}));
        if (!response.ok) { if (response.status === 401 && state.token) signOut(false); throw new Error(data.error || 'Request failed.'); }
        return data;
      }
      function setPage(name) {
        state.page = name;
        $('#explore-page').classList.toggle('hidden',name!=='explore');
        $('#mine-page').classList.toggle('hidden',name!=='mine');
        $('#chats-page').classList.toggle('hidden',name!=='chats');
        $$('.nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===name));
        $('#hero').classList.toggle('hidden', name!=='explore');
        $('.statline').classList.toggle('hidden', name!=='explore');
        if(name==='mine') loadMyGroups();
        if(name==='chats') loadConversations();
        $('#group-workspace').classList.add('hidden');
      }
      function setSignedIn(user) {
        state.user=user;
        $('#auth-open').classList.toggle('hidden',!!user);
        $('#logout').classList.toggle('hidden',!user);
        $('#account-avatar').classList.toggle('hidden',!user);
        $('#account-avatar').textContent=initials(user?.display_name||user?.username);
        $('#user-name').textContent=user ? (user.display_name||user.username) : '';
        $('#hero-create').textContent=user ? '＋ Create a group' : '＋ Create a group';
      }
      async function restoreSession() {
        if (!state.token) { setSignedIn(null); return; }
        try { const data=await api('/api/me'); setSignedIn(data.user); }
        catch { state.token=''; sessionStorage.removeItem('sc_token'); setSignedIn(null); }
      }
      function openAuth(mode='login') { state.authMode=mode; updateAuthMode(); $('#auth-modal').classList.remove('hidden'); setTimeout(()=>$('#auth-identifier').focus(),20); }
      function closeAuth() { $('#auth-modal').classList.add('hidden'); }
      function updateAuthMode() {
        const reg=state.authMode==='register';
        $('#auth-title').textContent=reg?'Create your learning account':'Welcome back';
        $('#auth-desc').textContent=reg?'Create an account to join study circles, chat, and share resources.':'Sign in to join groups, message peers, and keep your learning organised.';
        $('#auth-submit').textContent=reg?'Create account':'Sign in';
        $('#switch-copy').textContent=reg?'Already have an account?':'New here?';
        $('#auth-switch').textContent=reg?'Sign in':'Create an account';
        ['#register-name-wrap','#register-username-wrap','#register-email-wrap'].forEach(id=>$(id).classList.toggle('hidden',!reg));
        $('#auth-identifier').classList.toggle('hidden',reg);
        $('#auth-identifier').required=!reg;
        $('#auth-form [name="username"]').required=reg; $('#auth-form [name="email"]').required=reg; $('#auth-form [name="display_name"]').required=reg;
        $('#auth-form [name="password"]').autocomplete=reg?'new-password':'current-password';
      }
      function signOut(showMessage=true) { state.token='';state.user=null;sessionStorage.removeItem('sc_token');setSignedIn(null);state.myGroups=[];state.currentGroup=null;state.currentConversation=null;$('#group-workspace').classList.add('hidden');if(showMessage)toast('You have signed out.');setPage('explore'); }
      async function loadMeta() {
        try {
          const [topics,levels]=await Promise.all([api('/api/topics'),api('/api/levels')]);
          state.topics=topics.items||[];state.levels=levels.items||[];
          const subjects=[...new Map(state.topics.map(x=>[x.subject_id,{subject_id:x.subject_id,name:x.subject_name}])).values()];
          const subOpts='<option value="">All subjects</option>'+subjects.map(x=>`<option value="${x.subject_id}">${escapeHTML(x.name)}</option>`).join('');
          $('#subject-filter').innerHTML=subOpts;
          $('#create-subject').innerHTML='<option value="">Choose subject</option>'+subjects.map(x=>`<option value="${x.subject_id}">${escapeHTML(x.name)}</option>`).join('');
          const levelOpts=state.levels.map(x=>`<option value="${x.level_id}">${escapeHTML(x.name)}</option>`).join('');
          $('#level-filter').innerHTML='<option value="">All levels</option>'+levelOpts;
          $('#create-level').innerHTML='<option value="">Choose skill level</option>'+levelOpts;
        } catch(err) { toast(err.message,true); }
      }
      function groupCard(g, member=false) {
        const count=Number(g.member_count||0); const cap=g.max_members?` ${count}/${g.max_members} members`: `${count} members`;
        const level=g.level_name||'Mixed'; const isFull=g.status==='FULL'||(g.max_members && count>=Number(g.max_members)); const status=isFull?'Full':'Open';
        const isActive=member||g.viewer_membership_status==='ACTIVE';
        const isPending=!isActive&&g.viewer_request_status==='PENDING';
        const desc=g.short_description||g.full_description||'A friendly space to learn, practise, and work towards shared goals.';
        const action=isActive?'open':(isPending?'pending':(isFull?'full':'join'));
        const label=isActive?'Open group':(isPending?'Request pending':(isFull?'Group full':(g.visibility==='PRIVATE'?'Request to join':'Join group')));
        const disabled=isPending||(!isActive&&isFull);
        return `<article class="group-card glass"><div class="card-top"><span class="badge">${escapeHTML(g.subject_name||'Study')}</span><span class="badge ${g.visibility==='PRIVATE'?'gold':'green'}">${escapeHTML(g.visibility||'PUBLIC')}</span></div><h3>${escapeHTML(g.name)}</h3><p class="description">${escapeHTML(desc)}</p><div class="pills"><span class="pill">${escapeHTML(level)}</span><span class="pill">${escapeHTML(String(g.group_type||'STUDY').replaceAll('_',' '))}</span><span class="pill">${escapeHTML(cap)}</span></div><div class="card-bottom"><div class="owner"><div class="avatar">${escapeHTML(initials(g.owner_display_name||g.owner_username||g.role||'S'))}</div><div><small>${member?'Your role: '+escapeHTML(g.role||'MEMBER'):'Hosted by '+escapeHTML(g.owner_display_name||g.owner_username||'learner')}</small><small>${escapeHTML(status)}</small></div></div><button class="button small ${member?'soft':''}" data-group-action="${action}" data-group-id="${g.group_id}" ${disabled?'disabled':''}>${label}</button></div></article>`;
      }
      async function loadGroups() {
        const holder=$('#groups');holder.innerHTML='<div class="empty glass"><b>Finding your study circles…</b>Loading public and private groups.</div>';
        try {
          const params=new URLSearchParams();const search=$('#search').value.trim();const subject=$('#subject-filter').value;const level=$('#level-filter').value;
          if(search)params.set('search',search);if(subject)params.set('subjectId',subject);if(level)params.set('levelId',level);
          const data=await api('/api/groups?'+params.toString());state.groups=data.items||[];$('#stat-groups').textContent=state.groups.length;
          holder.innerHTML=state.groups.length?state.groups.map(g=>groupCard(g,false)).join(''):'<div class="empty glass"><b>No groups match those filters yet.</b>Try another subject, or create the first study group for this topic.</div>';
        }catch(err){holder.innerHTML=`<div class="empty glass"><b>Could not load groups</b>${escapeHTML(err.message)}</div>`;}
      }
      async function loadMyGroups() {
        const holder=$('#my-groups');
        if(!state.token){holder.innerHTML='<div class="empty glass"><b>Sign in to see your groups</b>Your active group memberships appear here.</div>';return;}
        holder.innerHTML='<div class="empty glass"><b>Loading your groups…</b></div>';
        try {const data=await api('/api/my/groups');state.myGroups=data.items||[];holder.innerHTML=state.myGroups.length?state.myGroups.map(g=>groupCard(g,true)).join(''):'<div class="empty glass"><b>Your study space starts here.</b>Join a group from Explore, or create a new one.</div>';}
        catch(err){holder.innerHTML=`<div class="empty glass"><b>Unable to load memberships</b>${escapeHTML(err.message)}</div>`;}
      }
      function requireLogin() { if(state.token&&state.user)return true;openAuth('login');toast('Sign in first to use this feature.');return false; }
      async function handleGroupAction(button) {
        const id=Number(button.dataset.groupId);const action=button.dataset.groupAction;
        if(action==='open'){await openGroup(id);return;}
        if(action==='pending'){toast('Your join request is still pending.');return;}
        if(action==='full'){toast('This group has reached its member limit.',true);return;}
        if(!requireLogin())return;
        button.disabled=true;
        try {const result=await api(`/api/groups/${id}/join`,{method:'POST',body:JSON.stringify({})});toast(result.message||'Group updated.');if(result.status==='ACTIVE')await openGroup(id);await loadGroups();if(state.page==='mine')await loadMyGroups();}
        catch(err){toast(err.message,true);}finally{button.disabled=false;}
      }
      async function openGroup(id) {
        if(!requireLogin())return;
        try {
          const data=await api(`/api/groups/${id}`);state.currentGroup=data.group;state.currentConversation=null;state.currentTab='chat';
          // The private group's detail endpoint only permits active members. Use that protected
          // member list to decide whether to render the request-review tab.
          const memberData=await api(`/api/groups/${id}/members`);
          const myMembership=(memberData.items||[]).find(m=>Number(m.user_id)===Number(state.user?.user_id));
          const canReviewRequests=['OWNER','MODERATOR'].includes(myMembership?.role);
          $('#join-requests-tab').classList.toggle('hidden',!canReviewRequests);
          $('#workspace-title').textContent=data.group.name;$('#workspace-meta').textContent=`${data.group.subject_name} · ${data.group.level_name} · ${data.group.member_count}/${data.group.max_members} members`;
          $('#group-workspace').classList.remove('hidden');$('#direct-workspace').classList.add('hidden');$$('[data-worktab]').forEach(b=>b.classList.toggle('active',b.dataset.worktab==='chat'));
          await loadWorkTab();$('#group-workspace').scrollIntoView({behavior:'smooth',block:'start'});
        } catch(err){toast(err.message,true);}
      }
      function localTime(value) { if(!value)return '';const d=new Date(value);return Number.isNaN(d.getTime())?String(value):d.toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
      async function loadWorkTab() {
        const panel=$('#work-panel');const g=state.currentGroup;if(!g)return;
        panel.innerHTML='<div class="empty"><b>Loading…</b></div>';
        try {
          if(state.currentTab==='chat') {
            const data=await api(`/api/groups/${g.group_id}/messages`);const items=data.items||[];
            panel.innerHTML=`<div id="group-chat-list" class="chat-list">${items.length?items.map(m=>messageHTML(m)).join(''):'<div class="empty"><b>Start the conversation</b>Ask a question, share an idea, or welcome a new member.</div>'}</div><form id="group-chat-form" class="chat-compose"><input class="field" name="body" maxlength="4000" placeholder="Write a message to the group…" required><button class="button" type="submit">Send ↗</button></form>`;
          } else if(state.currentTab==='resources') {
            const data=await api(`/api/groups/${g.group_id}/resources`);const items=data.items||[];
            panel.innerHTML=`<div class="split"><div class="panel"><h3>Shared resources</h3><div class="list-stack">${items.length?items.map(r=>`<div class="list-item"><div><b>${escapeHTML(r.title)} ${r.is_pinned?'📌':''}</b><p>${escapeHTML(r.resource_type)} · ${escapeHTML(r.description||'Shared by a group member')}</p><p><a href="${escapeHTML(r.resource_url)}" target="_blank" rel="noopener noreferrer">Open resource ↗</a></p></div></div>`).join(''):'<p class="notice">No resources shared yet. Add the first useful link.</p>'}</div></div><form id="resource-form" class="panel"><h3>Add a resource</h3><div class="list-stack"><input class="field" name="title" placeholder="Resource title" required maxlength="180"><input class="field" name="resource_url" type="url" placeholder="https://…" required><select class="field" name="resource_type"><option>LINK</option><option>DOCUMENT</option><option>VIDEO</option><option>NOTE</option><option>CODE</option><option>OTHER</option></select><textarea class="field" name="description" placeholder="What is useful about this?" rows="3"></textarea><button class="button" type="submit">Share resource</button></div></form></div>`;
          } else if(state.currentTab==='tasks') {
            const data=await api(`/api/groups/${g.group_id}/tasks`);const items=data.items||[];
            panel.innerHTML=`<div class="split"><div class="panel"><h3>Group tasks</h3><div class="list-stack">${items.length?items.map(t=>`<div class="list-item"><div><b>${escapeHTML(t.title)}</b><p>${escapeHTML(t.status)} · Due ${escapeHTML(t.due_at?localTime(t.due_at):'no due date')} · by ${escapeHTML(t.created_by)}</p><p>${escapeHTML(t.description||'')}</p></div><span class="badge">${escapeHTML(t.status)}</span></div>`).join(''):'<p class="notice">No tasks yet. Owners and moderators can add a shared learning goal.</p>'}</div></div><form id="task-form" class="panel"><h3>Create a task</h3><div class="list-stack"><input class="field" name="title" placeholder="e.g. Finish SQL joins practice" required maxlength="180"><textarea class="field" name="description" rows="3" placeholder="What should be completed?"></textarea><label class="notice">Optional due date <input class="field" type="datetime-local" name="due_at"></label><button class="button" type="submit">Create task</button><p class="notice">Only group owners and moderators can create tasks.</p></div></form></div>`;
          } else if(state.currentTab==='sessions') {
            const data=await api(`/api/groups/${g.group_id}/sessions`);const items=data.items||[];
            panel.innerHTML=`<div class="split"><div class="panel"><h3>Study sessions</h3><div class="list-stack">${items.length?items.map(t=>`<div class="list-item"><div><b>${escapeHTML(t.title)}</b><p>${escapeHTML(localTime(t.starts_at))} – ${escapeHTML(localTime(t.ends_at))} · ${escapeHTML(t.location_mode)}</p><p>${escapeHTML(t.description||'')}</p>${t.meeting_url?`<p><a href="${escapeHTML(t.meeting_url)}" target="_blank" rel="noopener noreferrer">Join meeting ↗</a></p>`:''}</div><span class="badge">${escapeHTML(t.status)}</span></div>`).join(''):'<p class="notice">No sessions are scheduled yet.</p>'}</div></div><form id="session-form" class="panel"><h3>Schedule a session</h3><div class="list-stack"><input class="field" name="title" placeholder="Session title" required maxlength="160"><textarea class="field" name="description" rows="2" placeholder="Plan or agenda"></textarea><label class="notice">Starts <input class="field" name="starts_at" type="datetime-local" required></label><label class="notice">Ends <input class="field" name="ends_at" type="datetime-local" required></label><select class="field" name="location_mode"><option>ONLINE</option><option>IN_PERSON</option><option>HYBRID</option></select><input class="field" name="meeting_url" type="url" placeholder="Meeting URL (optional)"><input class="field" name="location_text" placeholder="Room or location (optional)"><button class="button" type="submit">Schedule session</button><p class="notice">Only group owners and moderators can schedule.</p></div></form></div>`;
          } else if(state.currentTab==='members') {
            const data=await api(`/api/groups/${g.group_id}/members`);const items=data.items||[];
            panel.innerHTML=`<div class="panel"><h3>Active members</h3><div class="list-stack">${items.map(m=>`<div class="list-item"><div style="display:flex;align-items:center;gap:10px"><div class="avatar">${escapeHTML(initials(m.display_name))}</div><div><b>${escapeHTML(m.display_name)}</b><p>@${escapeHTML(m.username)} · ${escapeHTML(m.role)}</p></div></div><button class="button soft small" data-dm-user="${m.user_id}" ${Number(m.user_id)===Number(state.user?.user_id)?'disabled':''}>Message</button></div>`).join('')}</div></div>`;
          } else if(state.currentTab==='requests') {
            const data=await api(`/api/groups/${g.group_id}/requests`);const items=data.items||[];
            panel.innerHTML=`<div class="panel"><h3>Pending join requests (${items.length})</h3><p class="notice">Only group owners and moderators can review these requests.</p><div class="list-stack">${items.length?items.map(r=>`<div class="list-item"><div><b>${escapeHTML(r.display_name||r.username)}</b><p>@${escapeHTML(r.username)}</p><p>${escapeHTML(r.message||'No message provided.')}</p><small>${escapeHTML(localTime(r.created_at))}</small></div><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="button small" data-join-decision="APPROVED" data-request-id="${r.request_id}" data-group-id="${g.group_id}">Accept</button><button class="button danger small" data-join-decision="REJECTED" data-request-id="${r.request_id}" data-group-id="${g.group_id}">Reject</button></div></div>`).join(''):'<div class="empty"><b>No pending requests</b>New requests will appear here.</div>'}</div></div>`;
          }
        } catch(err) { panel.innerHTML=`<div class="empty"><b>Could not load this section</b>${escapeHTML(err.message)}</div>`; }
      }
      function messageHTML(m) {const mine=Number(m.sender_user_id)===Number(state.user?.user_id);return `<div class="message ${mine?'mine':''}"><div class="avatar">${escapeHTML(initials(m.sender_display_name||m.sender_username))}</div><div class="bubble-wrap"><small>${escapeHTML(mine?'You':(m.sender_display_name||m.sender_username||'Member'))} · ${escapeHTML(localTime(m.sent_at))}</small><div class="bubble">${escapeHTML(m.body||'')}</div></div></div>`;}
      async function loadConversations() {
        const holder=$('#conversations');if(!state.token){holder.innerHTML='<div class="empty glass"><b>Sign in to see your messages</b>Your group chats and private messages appear here.</div>';return;}
        holder.innerHTML='<div class="empty glass"><b>Loading conversations…</b></div>';
        try {const data=await api('/api/conversations');const items=data.items||[];holder.innerHTML=items.length?items.map(c=>{const name=c.conversation_type==='GROUP'?(c.group_name||'Study group'):(c.other_display_name||'Direct conversation');return `<div class="list-item glass"><div><b>${escapeHTML(name)}</b><p>${c.conversation_type==='GROUP'?'Group chat':'Private message'} · ${escapeHTML(localTime(c.last_message_at)||'No messages yet')}</p></div><button class="button small" data-open-conversation="${c.conversation_id}" data-conv-type="${c.conversation_type}" data-conv-group="${c.study_group_id||''}" data-conv-name="${escapeHTML(name)}">Open chat</button></div>`}).join(''):'<div class="empty glass"><b>No conversations yet</b>Join a group or message a member to get started.</div>';}
        catch(err){holder.innerHTML=`<div class="empty glass"><b>Unable to load messages</b>${escapeHTML(err.message)}</div>`;}
      }
      async function openConversation(id,type,groupId,name) {
        if(type==='GROUP'&&groupId){await openGroup(Number(groupId));return;}
        if(!requireLogin())return;
        state.currentConversation={id:Number(id),name:name||'Direct message'};
        const box=$('#direct-workspace');box.classList.remove('hidden');box.innerHTML=`<div class="workspace-head"><div><h2>${escapeHTML(state.currentConversation.name)}</h2><p>Private conversation</p></div><button class="ghost" id="close-direct">Close</button></div><div id="direct-chat-list" class="chat-list" style="margin-top:12px"></div><form id="direct-chat-form" class="chat-compose"><input class="field" name="body" placeholder="Write a private message…" maxlength="4000" required><button class="button" type="submit">Send ↗</button></form>`;
        await loadDirectMessages();box.scrollIntoView({behavior:'smooth',block:'start'});
      }
      async function loadDirectMessages() {
        if(!state.currentConversation)return;
        const data=await api(`/api/conversations/${state.currentConversation.id}/messages`);const list=$('#direct-chat-list');if(!list)return;
        list.innerHTML=data.items.length?data.items.map(messageHTML).join(''):'<div class="empty"><b>Say hello</b>This conversation is ready for your first message.</div>';list.scrollTop=list.scrollHeight;
      }
      async function handleAuthSubmit(event) {
        event.preventDefault();const form=event.currentTarget;const data=new FormData(form);const reg=state.authMode==='register';
        const payload=reg?{username:data.get('username'),email:data.get('email'),display_name:data.get('display_name'),password:data.get('password')}:{identifier:data.get('identifier'),password:data.get('password')};
        const submit=$('#auth-submit');submit.disabled=true;
        try {const result=await api(reg?'/api/auth/register':'/api/auth/login',{method:'POST',body:JSON.stringify(payload)});state.token=result.token;sessionStorage.setItem('sc_token',state.token);setSignedIn(result.user);closeAuth();form.reset();toast(reg?'Account created. Welcome to StudySphere!':'Signed in successfully.');await Promise.all([loadGroups(),loadMyGroups()]);}
        catch(err){toast(err.message,true);}finally{submit.disabled=false;}
      }
      async function createGroup(event) {
        event.preventDefault();if(!requireLogin())return;const f=event.currentTarget;const fd=new FormData(f);const payload=Object.fromEntries(fd.entries());payload.subject_id=Number(payload.subject_id);payload.level_id=Number(payload.level_id);payload.max_members=Number(payload.max_members);
        try {const result=await api('/api/groups',{method:'POST',body:JSON.stringify(payload)});f.reset();$('#create-panel').classList.add('hidden');toast(result.message||'Group created.');await loadGroups();await loadMyGroups();await openGroup(result.group_id);}
        catch(err){toast(err.message,true);}
      }
      async function handlePanelSubmit(event) {
        const form=event.target;if(!form.id)return;
        try {
          if(form.id==='group-chat-form') {event.preventDefault();const body=new FormData(form).get('body').toString().trim();if(!body)return;await api(`/api/groups/${state.currentGroup.group_id}/messages`,{method:'POST',body:JSON.stringify({body})});form.reset();await loadWorkTab();}
          if(form.id==='resource-form') {event.preventDefault();const p=Object.fromEntries(new FormData(form).entries());await api(`/api/groups/${state.currentGroup.group_id}/resources`,{method:'POST',body:JSON.stringify(p)});toast('Resource shared.');await loadWorkTab();}
          if(form.id==='task-form') {event.preventDefault();const p=Object.fromEntries(new FormData(form).entries());if(p.due_at)p.due_at=new Date(p.due_at).toISOString();else p.due_at=null;await api(`/api/groups/${state.currentGroup.group_id}/tasks`,{method:'POST',body:JSON.stringify(p)});toast('Task created.');await loadWorkTab();}
          if(form.id==='session-form') {event.preventDefault();const p=Object.fromEntries(new FormData(form).entries());p.starts_at=new Date(p.starts_at).toISOString();p.ends_at=new Date(p.ends_at).toISOString();await api(`/api/groups/${state.currentGroup.group_id}/sessions`,{method:'POST',body:JSON.stringify(p)});toast('Study session scheduled.');await loadWorkTab();}
          if(form.id==='direct-chat-form') {event.preventDefault();const body=new FormData(form).get('body').toString().trim();if(!body)return;await api(`/api/conversations/${state.currentConversation.id}/messages`,{method:'POST',body:JSON.stringify({body})});form.reset();await loadDirectMessages();}
        } catch(err) {toast(err.message,true);}
      }
      function toggleCreate() {if(!requireLogin())return;$('#create-panel').classList.remove('hidden');$('#create-panel').scrollIntoView({behavior:'smooth',block:'start'});}
      async function startDirect(userId) {
        if(!requireLogin())return;
        try {const result=await api(`/api/dm/${userId}`,{method:'POST',body:JSON.stringify({})});await setPage('chats');await loadConversations();await openConversation(result.conversation_id,'DIRECT',null,`Private conversation with user #${userId}`);}
        catch(err){toast(err.message,true);}
      }
      document.addEventListener('click', async (event) => {
        if(event.target.closest('#close-direct')) { $('#direct-workspace').classList.add('hidden'); return; }
        const nav=event.target.closest('[data-page]');if(nav){setPage(nav.dataset.page);return;}
        const groupBtn=event.target.closest('[data-group-action]');if(groupBtn){await handleGroupAction(groupBtn);return;}
        const decisionButton=event.target.closest('[data-join-decision]');
        if(decisionButton){
          if(!requireLogin())return;
          const groupId=Number(decisionButton.dataset.groupId), requestId=Number(decisionButton.dataset.requestId), decision=decisionButton.dataset.joinDecision;
          decisionButton.disabled=true;
          try {
            const result=await api(`/api/groups/${groupId}/requests/${requestId}/decision`,{method:'POST',body:JSON.stringify({decision})});
            toast(result.message||'Join request updated.');
            await Promise.all([loadWorkTab(),loadGroups(),loadMyGroups()]);
          } catch(err){toast(err.message,true);decisionButton.disabled=false;}
          return;
        }
        const workTab=event.target.closest('[data-worktab]');if(workTab){if(workTab.classList.contains('hidden'))return;state.currentTab=workTab.dataset.worktab;$$('[data-worktab]').forEach(b=>b.classList.toggle('active',b===workTab));await loadWorkTab();return;}
        const conv=event.target.closest('[data-open-conversation]');if(conv){await openConversation(Number(conv.dataset.openConversation),conv.dataset.convType,conv.dataset.convGroup,conv.dataset.convName);return;}
        const dm=event.target.closest('[data-dm-user]');if(dm){await startDirect(Number(dm.dataset.dmUser));return;}
      });
      $('#auth-open').addEventListener('click',()=>openAuth('login'));$('#hero-create').addEventListener('click',toggleCreate);$('#create-open').addEventListener('click',toggleCreate);$('#mine-create').addEventListener('click',toggleCreate);
      $('#hero-explore').addEventListener('click',()=>{setPage('explore');$('#search').focus();});$('#close-create').addEventListener('click',()=>$('#create-panel').classList.add('hidden'));
      $('#close-workspace').addEventListener('click',()=>{$('#group-workspace').classList.add('hidden');state.currentGroup=null;});$('#refresh-workspace').addEventListener('click',loadWorkTab);
      $('#auth-close').addEventListener('click',closeAuth);$('#auth-modal').addEventListener('click',e=>{if(e.target===$('#auth-modal'))closeAuth();});$('#auth-switch').addEventListener('click',()=>{state.authMode=state.authMode==='login'?'register':'login';updateAuthMode();});
      $('#auth-form').addEventListener('submit',handleAuthSubmit);$('#logout').addEventListener('click',()=>signOut());$('#search-button').addEventListener('click',loadGroups);$('#search').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();loadGroups();}});$('#subject-filter').addEventListener('change',loadGroups);$('#level-filter').addEventListener('change',loadGroups);$('#create-form').addEventListener('submit',createGroup);$('#refresh-conversations').addEventListener('click',loadConversations);
      document.addEventListener('submit',handlePanelSubmit);
      (async()=>{await restoreSession();await loadMeta();await loadGroups();if(state.token)await loadMyGroups();})();
    })();
