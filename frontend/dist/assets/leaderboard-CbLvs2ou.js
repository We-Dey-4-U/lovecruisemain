import"./app-By3Wcv2E.js";/* empty css              */if(!window.requireAuthOrRedirect())throw Error(`Auth required`);var e=`gifters`,t=`today`,n=`sent`;document.getElementById(`lb-type-tabs`).addEventListener(`click`,t=>{let n=t.target.closest(`.lb-type-tab`);n&&(e=n.dataset.type,document.querySelectorAll(`.lb-type-tab`).forEach(e=>e.classList.remove(`active`)),n.classList.add(`active`),document.getElementById(`lb-direction-row`).classList.toggle(`show`,e===`biggest`),c())}),document.getElementById(`lb-period-row`).addEventListener(`click`,e=>{let n=e.target.closest(`.lb-period-chip`);n&&(t=n.dataset.period,document.querySelectorAll(`.lb-period-chip`).forEach(e=>e.classList.remove(`active`)),n.classList.add(`active`),c())}),document.getElementById(`lb-direction-row`).addEventListener(`click`,e=>{let t=e.target.closest(`.lb-direction-btn`);t&&(n=t.dataset.direction,document.querySelectorAll(`.lb-direction-btn`).forEach(e=>e.classList.remove(`active`)),t.classList.add(`active`),c())});async function r(){let n=document.getElementById(`lb-my-rank`);if(e===`biggest`){n.style.display=`none`;return}let r=e===`receivers`?`receiver`:`gifter`;try{let e=(await window.api.request(`/leaderboard/me?type=${r}&period=${t}`)).data||{},i=window.CURRENT_USER||{},a=i.avatarUrl||i.avatar_url||`https://ui-avatars.com/api/?name=${encodeURIComponent(i.displayName||i.display_name||i.username||`U`)}&background=ff3d7f&color=fff&size=80`;document.getElementById(`my-rank-avatar`).src=a,document.getElementById(`my-rank-coins`).textContent=`${window.formatCoins(e.total_coins||0)} coins ${r===`gifter`?`sent`:`received`}`,document.getElementById(`my-rank-num`).textContent=e.rank?`#${e.rank}`:`—`,n.style.display=`flex`}catch(e){console.error(`[leaderboard] my-rank load failed:`,e),n.style.display=`none`}}async function i(){let r=document.getElementById(`lb-list`);r.innerHTML=`<div class="skel-lb-row"></div><div class="skel-lb-row"></div><div class="skel-lb-row"></div><div class="skel-lb-row"></div>`;try{let i;i=e===`gifters`?`/leaderboard/gifters?period=${t}&limit=50`:e===`receivers`?`/leaderboard/receivers?period=${t}&limit=50`:`/leaderboard/biggest-gifts?period=${t}&direction=${n}&limit=50`;let a=(await window.api.request(i)).data||[];if(!a.length){r.innerHTML=`
        <div class="empty-lb">
          <div class="icon">🏆</div>
          <h3 style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">Nobody here yet</h3>
          <p style="font-size:12.5px;">Be the first to ${e===`receivers`?`receive`:`send`} a gift this period.</p>
        </div>`;return}let o=String(window.CURRENT_USER?.id||``);r.innerHTML=a.map((e,t)=>s(e,t,o)).join(``),r.querySelectorAll(`[data-user-id]`).forEach(e=>{e.addEventListener(`click`,()=>{window.location.href=`profile.html?id=${e.dataset.userId}`})})}catch(e){console.error(`[leaderboard] list load failed:`,e),r.innerHTML=`
      <div class="empty-lb">
        <div class="icon">⚠️</div>
        <h3 style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:6px;">Couldn't load leaderboard</h3>
        <p style="font-size:12.5px;">${window.escapeHtml(e.message||`Check your connection and try again.`)}</p>
      </div>`}}function a(e){return e===1?`top1`:e===2?`top2`:e===3?`top3`:``}function o(e){return e===1?`🥇`:e===2?`🥈`:e===3?`🥉`:`#${e}`}function s(t,n,r){if(e===`biggest`){let e=n+1,i=String(t.user_id)===r,s=t.avatar_url||`https://ui-avatars.com/api/?name=${encodeURIComponent(t.display_name||t.username||`U`)}&background=random&color=fff&size=80`;return`
      <div class="lb-row ${i?`me`:``}" data-user-id="${t.user_id}">
        <span class="lb-rank-num ${a(e)}">${o(e)}</span>
        <img src="${window.escapeHtml(s)}" alt="" onerror="this.src='https://i.pravatar.cc/100'">
        <div class="name-block">
          <strong>${window.escapeHtml(t.display_name||t.username||`User`)}</strong>
          <small class="lb-gift-row"><span class="lb-gift-emoji">${t.emoji||`🎁`}</span> ${window.escapeHtml(t.gift_name||`Gift`)} ×${t.quantity||1}</small>
        </div>
        <div class="coins">
          <div class="amt">${window.formatCoins(t.total_coins||0)}</div>
          <div class="sub">${window.timeAgo(t.created_at)}</div>
        </div>
      </div>`}let i=t.rank||n+1,s=String(t.id)===r,c=t.avatar_url||`https://ui-avatars.com/api/?name=${encodeURIComponent(t.display_name||t.username||`U`)}&background=random&color=fff&size=80`,l=e===`receivers`?`${window.formatCoins(t.unique_gifters||0)} gifters · ${window.formatCoins(t.gift_count||0)} gifts`:`${window.formatCoins(t.hosts_supported||0)} hosts · ${window.formatCoins(t.gift_count||0)} gifts`;return`
    <div class="lb-row ${s?`me`:``}" data-user-id="${t.id}">
      <span class="lb-rank-num ${a(i)}">${o(i)}</span>
      <img src="${window.escapeHtml(c)}" alt="" onerror="this.src='https://i.pravatar.cc/100'">
      <div class="name-block">
        <strong>${window.escapeHtml(t.display_name||t.username||`User`)}${t.is_verified?`<span class="verified-dot-sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></span>`:``}${s?` (You)`:``}</strong>
        <small>${l}</small>
      </div>
      <div class="coins">
        <div class="amt">${window.formatCoins(t.total_coins||0)}</div>
        <div class="sub">${e===`receivers`?`received`:`sent`}</div>
      </div>
    </div>`}async function c(){await Promise.all([r(),i()])}c();