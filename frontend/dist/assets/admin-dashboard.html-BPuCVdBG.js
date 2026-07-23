import"./app-CDuEJM5E.js";/* empty css              */if(!requireAuthOrRedirect())throw Error(`auth required`);var e=window.CURRENT_USER||{};if(e.role!==`admin`)throw showToast(`Admins only`),setTimeout(()=>{window.location.href=`home.html`},700),Error(`not admin`);document.getElementById(`admin-who`).textContent=`${e.displayName||e.username||`Admin`} · @${e.username||`admin`}`,document.getElementById(`admin-logout-btn`).addEventListener(`click`,()=>{confirm(`Log out?`)&&logout()});var t={overview:`Overview`,sellers:`Seller Applications`,users:`Users`,withdrawals:`Withdrawals`,verifications:`Verifications`,reports:`Reports`,gifts:`Gifts`,liverooms:`Live Rooms`,settings:`Settings`},n=new Set;document.getElementById(`admin-nav`).addEventListener(`click`,e=>{let n=e.target.closest(`.admin-nav-item`);if(!n)return;let i=n.dataset.panel;document.querySelectorAll(`.admin-nav-item`).forEach(e=>e.classList.remove(`active`)),document.querySelectorAll(`.admin-panel`).forEach(e=>e.classList.remove(`active`)),n.classList.add(`active`),document.getElementById(`panel-${i}`).classList.add(`active`),document.getElementById(`admin-panel-title`).textContent=t[i]||i,r(i)});function r(e,t=!1){n.has(e)&&!t||(n.add(e),{overview:i,sellers:()=>s(o),users:l,withdrawals:u,verifications:d,reports:f,gifts:p,liverooms:m,settings:h}[e]?.())}async function i(){try{let e=(await api.request(`/admin/dashboard`)).data||{};document.getElementById(`overview-stats`).innerHTML=`
      <div class="stat-card"><div class="sc-label">Total Users</div><div class="sc-val">${formatCoins(e.totalUsers)}</div></div>
      <div class="stat-card"><div class="sc-label">Active Live Rooms</div><div class="sc-val">${formatCoins(e.activeLiveRooms)}</div></div>
      <div class="stat-card"><div class="sc-label">Total Gifts</div><div class="sc-val">${formatCoins(e.totalGifts)}</div></div>
      <div class="stat-card gold"><div class="sc-label">Total Revenue</div><div class="sc-val">₦${formatCoins(e.totalRevenue)}</div></div>
      <div class="stat-card accent"><div class="sc-label">Pending Withdrawals</div><div class="sc-val">${formatCoins(e.pendingWithdrawals)}</div></div>`,e.pendingWithdrawals>0&&a(`nav-withdrawals-badge`,e.pendingWithdrawals)}catch(e){showToast(e.message||`Could not load dashboard`)}try{let e=(await api.request(`/admin/analytics`)).data||{};document.getElementById(`analytics-grid`).innerHTML=Object.entries(e).map(([e,t])=>`
      <div class="stat-card"><div class="sc-label">${escapeHtml(e)}</div><div class="sc-val">${formatCoins(t)}</div></div>`).join(``)}catch{document.getElementById(`analytics-grid`).innerHTML=`<div class="empty-row">Could not load analytics</div>`}try{a(`nav-sellers-badge`,((await api.request(`/sellers/applications?status=pending`)).data||[]).length)}catch{}}function a(e,t){let n=document.getElementById(e);n&&(t>0?(n.textContent=t>99?`99+`:t,n.style.display=`inline-block`):n.style.display=`none`)}var o=`pending`;document.getElementById(`sellers-subtabs`).addEventListener(`click`,e=>{let t=e.target.closest(`.subtab`);t&&(document.querySelectorAll(`#sellers-subtabs .subtab`).forEach(e=>e.classList.remove(`active`)),t.classList.add(`active`),o=t.dataset.status,s(o))});async function s(e=`pending`){let t=document.getElementById(`sellers-tbody`);t.innerHTML=`<tr><td colspan="6" class="loading-row">Loading…</td></tr>`;try{let n=(await api.request(`/sellers/applications?status=${e}&limit=100`)).data||[];if(e===`pending`&&a(`nav-sellers-badge`,n.length),!n.length){t.innerHTML=`<tr><td colspan="6" class="empty-row">No ${escapeHtml(e)} applications</td></tr>`;return}t.innerHTML=n.map(t=>{let n=t.avatar_url||`https://ui-avatars.com/api/?name=${encodeURIComponent(t.display_name||t.username)}&size=64`;return`<tr data-id="${t.id}">
        <td><div class="cell-user"><img src="${escapeHtml(n)}" onerror="this.src='https://i.pravatar.cc/64'"><div><div>${escapeHtml(t.display_name||t.username)}</div><div class="cell-sub">@${escapeHtml(t.username)} · ${escapeHtml(t.email||``)}</div></div></div></td>
        <td>${escapeHtml(t.reason||t.business_name||`—`)}</td>
        <td>${escapeHtml(t.contact_info||`—`)}</td>
        <td>${timeAgo(t.created_at)} ago</td>
        <td><span class="pill pill-${t.status}">${escapeHtml(t.status)}</span></td>
        <td>${e===`pending`?`
          <div class="row-actions">
            <button class="approve" data-action="approve">Approve</button>
            <button class="reject" data-action="reject">Reject</button>
          </div>`:``}</td>
      </tr>`}).join(``),t.querySelectorAll(`[data-action]`).forEach(e=>{e.addEventListener(`click`,()=>{let t=e.closest(`tr`).dataset.id;e.dataset.action===`approve`?c(t,!0):c(t,!1,prompt(`Rejection reason (optional):`)||void 0)})})}catch(e){t.innerHTML=`<tr><td colspan="6" class="empty-row">${escapeHtml(e.message||`Could not load applications`)}</td></tr>`}}async function c(e,t,n){try{await api.request(`/sellers/applications/${e}`,{method:`PATCH`,body:JSON.stringify({approve:t,rejectionReason:n})}),showToast(t?`Seller approved — their upload form is now unlocked ✓`:`Application rejected`),s(o)}catch(e){showToast(e.message||`Action failed`)}}async function l(){let e=document.getElementById(`users-tbody`);e.innerHTML=`<tr><td colspan="7" class="loading-row">Loading…</td></tr>`;try{let t=(await api.request(`/admin/users`)).data||[];if(!t.length){e.innerHTML=`<tr><td colspan="7" class="empty-row">No users</td></tr>`;return}e.innerHTML=t.map(e=>`
      <tr data-id="${e.id}">
        <td><div class="cell-user"><img src="https://ui-avatars.com/api/?name=${encodeURIComponent(e.username)}&size=64"><div><div>${escapeHtml(e.display_name||e.username)}</div><div class="cell-sub">@${escapeHtml(e.username)} ${e.is_verified?`✅`:``}</div></div></div></td>
        <td>${escapeHtml(e.email)}</td>
        <td>
          <select class="inline-select role-select">
            ${[`user`,`streamer`,`qualified_host`,`moderator`,`admin`].map(t=>`<option value="${t}" ${e.role===t?`selected`:``}>${t}</option>`).join(``)}
          </select>
        </td>
        <td>
          <select class="inline-select status-select">
            ${[`active`,`suspended`,`banned`].map(t=>`<option value="${t}" ${e.status===t?`selected`:``}>${t}</option>`).join(``)}
          </select>
        </td>
        <td>${formatCoins(e.coin_balance)}</td>
        <td>${formatCoins(e.earnings_balance)}</td>
        <td><div class="row-actions"><button class="danger" data-action="delete">Delete</button></div></td>
      </tr>`).join(``),e.querySelectorAll(`tr`).forEach(e=>{let t=e.dataset.id;e.querySelector(`.role-select`).addEventListener(`change`,async e=>{try{await api.request(`/admin/users/${t}/role`,{method:`PATCH`,body:JSON.stringify({role:e.target.value})}),showToast(`Role updated`)}catch(e){showToast(e.message||`Update failed`)}}),e.querySelector(`.status-select`).addEventListener(`change`,async e=>{try{await api.request(`/admin/users/${t}/status`,{method:`PATCH`,body:JSON.stringify({status:e.target.value})}),showToast(`Status updated`)}catch(e){showToast(e.message||`Update failed`)}}),e.querySelector(`[data-action="delete"]`).addEventListener(`click`,async()=>{if(confirm(`Delete this user permanently?`))try{await api.request(`/admin/users/${t}`,{method:`DELETE`}),e.remove(),showToast(`User deleted`)}catch(e){showToast(e.message||`Delete failed`)}})})}catch(t){e.innerHTML=`<tr><td colspan="7" class="empty-row">${escapeHtml(t.message||`Could not load users`)}</td></tr>`}}async function u(){let e=document.getElementById(`withdrawals-tbody`);e.innerHTML=`<tr><td colspan="6" class="loading-row">Loading…</td></tr>`;try{let t=(await api.request(`/admin/withdrawals`)).data||[];if(a(`nav-withdrawals-badge`,t.filter(e=>e.status===`pending`).length),!t.length){e.innerHTML=`<tr><td colspan="6" class="empty-row">No withdrawal requests</td></tr>`;return}e.innerHTML=t.map(e=>`
      <tr data-id="${e.id}">
        <td>${escapeHtml(e.display_name||e.username)}<div class="cell-sub">${escapeHtml(e.email||``)}</div></td>
        <td>${formatCoins(e.coins_requested)}</td>
        <td>${e.currency||`NGN`} ${formatCoins(e.cash_amount)}</td>
        <td>${escapeHtml(e.bank_name||`—`)}<div class="cell-sub">${escapeHtml(e.bank_account_name||``)} · ${escapeHtml(e.bank_account_number||``)}</div></td>
        <td><span class="pill pill-${e.status}">${escapeHtml(e.status)}</span></td>
        <td>${e.status===`pending`?`
          <div class="row-actions">
            <button class="approve" data-action="approved">Approve</button>
            <button class="approve" data-action="paid">Mark paid</button>
            <button class="reject" data-action="rejected">Reject</button>
          </div>`:``}</td>
      </tr>`).join(``),e.querySelectorAll(`[data-action]`).forEach(e=>{e.addEventListener(`click`,async()=>{let t=e.closest(`tr`).dataset.id,n=e.dataset.action===`rejected`&&prompt(`Reason (optional):`)||``;try{await api.request(`/admin/withdrawals/${t}`,{method:`PATCH`,body:JSON.stringify({status:e.dataset.action,adminNote:n})}),showToast(`Withdrawal updated`),u()}catch(e){showToast(e.message||`Update failed`)}})})}catch(t){e.innerHTML=`<tr><td colspan="6" class="empty-row">${escapeHtml(t.message||`Could not load withdrawals`)}</td></tr>`}}async function d(){let e=document.getElementById(`verifications-tbody`);e.innerHTML=`<tr><td colspan="4" class="loading-row">Loading…</td></tr>`;try{let t=(await api.request(`/admin/verifications`)).data||[];if(!t.length){e.innerHTML=`<tr><td colspan="4" class="empty-row">No verification requests</td></tr>`;return}e.innerHTML=t.map(e=>`
      <tr data-id="${e.id}">
        <td>${escapeHtml(e.username)}<div class="cell-sub">${escapeHtml(e.email||``)}</div></td>
        <td>${e.document_url?`<a href="${escapeHtml(e.document_url)}" target="_blank" style="color:var(--magenta)">View document</a>`:`—`}</td>
        <td><span class="pill pill-${e.status}">${escapeHtml(e.status)}</span></td>
        <td>${e.status===`pending`?`
          <div class="row-actions">
            <button class="approve" data-action="approved">Approve</button>
            <button class="reject" data-action="rejected">Reject</button>
          </div>`:``}</td>
      </tr>`).join(``),e.querySelectorAll(`[data-action]`).forEach(e=>{e.addEventListener(`click`,async()=>{let t=e.closest(`tr`).dataset.id;try{await api.request(`/admin/verifications/${t}`,{method:`PATCH`,body:JSON.stringify({status:e.dataset.action})}),showToast(`Verification updated`),d()}catch(e){showToast(e.message||`Update failed`)}})})}catch(t){e.innerHTML=`<tr><td colspan="4" class="empty-row">${escapeHtml(t.message||`Could not load verifications`)}</td></tr>`}}async function f(){let e=document.getElementById(`reports-tbody`);e.innerHTML=`<tr><td colspan="5" class="loading-row">Loading…</td></tr>`;try{let t=(await api.request(`/admin/reports`)).data||[];if(!t.length){e.innerHTML=`<tr><td colspan="5" class="empty-row">No reports</td></tr>`;return}e.innerHTML=t.map(e=>`
      <tr>
        <td>${escapeHtml(e.reporter_username||`—`)}</td>
        <td>${escapeHtml(e.reported_username||`—`)}</td>
        <td>${escapeHtml(e.reason)}</td>
        <td>${escapeHtml(e.context_type||`—`)}</td>
        <td><span class="pill pill-${e.status}">${escapeHtml(e.status)}</span></td>
      </tr>`).join(``)}catch(t){e.innerHTML=`<tr><td colspan="5" class="empty-row">${escapeHtml(t.message||`Could not load reports`)}</td></tr>`}}async function p(){let e=document.getElementById(`gifts-tbody`);e.innerHTML=`<tr><td colspan="6" class="loading-row">Loading…</td></tr>`;try{let t=(await api.request(`/admin/gifts`)).data||[];if(!t.length){e.innerHTML=`<tr><td colspan="6" class="empty-row">No gifts yet</td></tr>`;return}e.innerHTML=t.map(e=>`
      <tr data-id="${e.id}">
        <td>${e.emoji||`🎁`} ${escapeHtml(e.name)}</td>
        <td>${escapeHtml(e.category||`—`)}</td>
        <td>${formatCoins(e.price_coins)} 🪙</td>
        <td>${e.is_golden_love?`✅`:`—`}</td>
        <td>${e.is_active?`✅`:`—`}</td>
        <td><div class="row-actions"><button class="danger" data-action="delete">Delete</button></div></td>
      </tr>`).join(``),e.querySelectorAll(`[data-action="delete"]`).forEach(e=>{e.addEventListener(`click`,async()=>{let t=e.closest(`tr`).dataset.id;if(confirm(`Delete this gift?`))try{await api.request(`/admin/gifts/${t}`,{method:`DELETE`}),p(),showToast(`Gift deleted`)}catch(e){showToast(e.message||`Delete failed`)}})})}catch(t){e.innerHTML=`<tr><td colspan="6" class="empty-row">${escapeHtml(t.message||`Could not load gifts`)}</td></tr>`}}document.getElementById(`add-gift-btn`).addEventListener(`click`,async()=>{let e=document.getElementById(`new-gift-name`).value.trim();document.getElementById(`new-gift-emoji`).value.trim();let t=Number(document.getElementById(`new-gift-price`).value);if(!e||!t){showToast(`Name and price are required`);return}try{await api.request(`/admin/gifts`,{method:`POST`,body:JSON.stringify({name:e,price_coins:t})}),document.getElementById(`new-gift-name`).value=``,document.getElementById(`new-gift-emoji`).value=``,document.getElementById(`new-gift-price`).value=``,showToast(`Gift added ✓`),p()}catch(e){showToast(e.message||`Could not add gift`)}});async function m(){let e=document.getElementById(`liverooms-tbody`);e.innerHTML=`<tr><td colspan="6" class="loading-row">Loading…</td></tr>`;try{let t=(await api.request(`/admin/live-rooms`)).data||[];if(!t.length){e.innerHTML=`<tr><td colspan="6" class="empty-row">No live rooms</td></tr>`;return}e.innerHTML=t.map(e=>`
      <tr>
        <td>${escapeHtml(e.username)}</td>
        <td>${escapeHtml(e.title)}</td>
        <td><span class="pill pill-${e.status}">${escapeHtml(e.status)}</span></td>
        <td>${formatCoins(e.viewer_count)}</td>
        <td>${formatCoins(e.total_coins_earned)} 🪙</td>
        <td>${timeAgo(e.started_at)} ago</td>
      </tr>`).join(``)}catch(t){e.innerHTML=`<tr><td colspan="6" class="empty-row">${escapeHtml(t.message||`Could not load live rooms`)}</td></tr>`}}async function h(){let e=document.getElementById(`settings-tbody`);e.innerHTML=`<tr><td colspan="3" class="loading-row">Loading…</td></tr>`;try{let t=(await api.request(`/admin/settings`)).data||[];if(!t.length){e.innerHTML=`<tr><td colspan="3" class="empty-row">No settings configured</td></tr>`;return}e.innerHTML=t.map(e=>`
      <tr data-key="${escapeHtml(e.setting_key)}">
        <td>${escapeHtml(e.setting_key)}</td>
        <td><input type="text" class="inline-input setting-value" value="${escapeHtml(e.setting_value||``)}" style="width:100%"></td>
        <td><div class="row-actions"><button class="approve" data-action="save">Save</button></div></td>
      </tr>`).join(``),e.querySelectorAll(`[data-action="save"]`).forEach(e=>{e.addEventListener(`click`,async()=>{let t=e.closest(`tr`),n=t.dataset.key,r=t.querySelector(`.setting-value`).value;try{await api.request(`/admin/settings/${n}`,{method:`PATCH`,body:JSON.stringify({value:r})}),showToast(`Setting saved`)}catch(e){showToast(e.message||`Save failed`)}})})}catch(t){e.innerHTML=`<tr><td colspan="3" class="empty-row">${escapeHtml(t.message||`Could not load settings`)}</td></tr>`}}r(`overview`);