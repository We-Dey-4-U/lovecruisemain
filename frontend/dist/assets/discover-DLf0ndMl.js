import"./app-CDuEJM5E.js";/* empty css              */if(!window.requireAuthOrRedirect())throw Error(`Auth required`);document.getElementById(`coin-balance`).textContent=window.formatCoins(window.CURRENT_USER.coinBalance||window.CURRENT_USER.coin_balance||0);var e=[[`rgba(255,61,127,.7)`,`rgba(120,0,255,.5)`],[`rgba(0,217,181,.65)`,`rgba(0,100,255,.5)`],[`rgba(255,160,0,.65)`,`rgba(255,61,127,.5)`],[`rgba(100,0,255,.65)`,`rgba(0,217,181,.5)`],[`rgba(0,180,255,.6)`,`rgba(0,60,180,.5)`],[`rgba(255,80,80,.65)`,`rgba(200,0,100,.5)`]],t=[];document.getElementById(`filter-tabs`).addEventListener(`click`,e=>{let n=e.target.closest(`.filter-tab`);n&&(n.dataset.filter,document.querySelectorAll(`.filter-tab`).forEach(e=>e.classList.remove(`active`)),n.classList.add(`active`),i(t))}),document.getElementById(`coin-pill-btn`).addEventListener(`click`,()=>{window.location.href=`coins.html`}),document.getElementById(`notif-btn`).addEventListener(`click`,()=>{window.showToast(`No new notifications`)}),document.getElementById(`add-story-btn`).addEventListener(`click`,()=>{window.showToast(`Story creation coming soon`)}),document.getElementById(`promo-topup-btn`).addEventListener(`click`,()=>{window.location.href=`coins.html`});function n(e){return(e.mode||e.room_type||e.roomType||e.live_type||``).toLowerCase()===`podcast`?`podcast`:`social`}function r(e,t){let n=encodeURIComponent(e.id);return t===`podcast`?`podcast-live.html?${new URLSearchParams({room:e.id,title:e.title||e.pod_title||`Live Podcast`,show:e.show_name||e.pod_show_name||``,cover:e.cover_image_url||e.cover_image||``}).toString()}`:`live.html?room=${n}`}function i(t){let i=document.getElementById(`live-grid`),o=document.getElementById(`live-count`);if(o.textContent=t.length?`${t.length} live`:`No live`,!t.length){i.innerHTML=`
      <div class="empty-live">
        <div class="icon">📡</div>
        <h3>Nobody's live right now</h3>
        <p>Be the first to go live and grow your audience.</p>
      </div>`;return}i.innerHTML=t.map((t,i)=>{if(!t.id)return``;let o=n(t),s=r(t,o),c=e[i%e.length],l=t.avatar_url||``,u=t.cover_image_url||t.cover_image||l,d=t.username||t.display_name||`Host`,f=t.title||(o===`podcast`?`Live Podcast`:`Live Stream`),p=t.viewer_count||0,m=d.split(` `).map(e=>e[0]||``).join(``).slice(0,2).toUpperCase(),h=u.trim().length>0,g=o===`podcast`?`live-badge mode-podcast`:`live-badge`,_=o===`podcast`?`PODCAST`:`LIVE`,v=o===`podcast`?`card-host-live-dot mode-podcast`:`card-host-live-dot`;return`
      <a class="live-card" href="${s}"
         style="--card-color-a:${c[0]};--card-color-b:${c[1]};">
        <div class="card-bg-gradient"></div>
        ${h?``:`<div class="card-initials">${window.escapeHtml(m)}</div>`}
        ${h?`<img class="card-host-photo" src="${window.escapeHtml(u)}" alt="" loading="lazy">`:``}
        <div class="card-scrim"></div>
        <span class="${g}"><span class="pulse"></span>${_}</span>
        <span class="viewer-chip-card">👁 ${window.formatCoins(p)}</span>
        <div class="card-info">
          <div class="card-host-row">
            <span class="${v}"></span>
            <span class="card-host-name">${window.escapeHtml(d)}</span>
          </div>
          <div class="card-title">${window.escapeHtml(f)}</div>
          ${p>1?`
          <div class="card-watchers">
            ${[...Array(Math.min(3,p))].map(()=>`<div class="card-watcher-dot" style="background:${a()}"></div>`).join(``)}
            <span class="card-watchers-label">${p>3?`+${p-3} watching`:`watching`}</span>
          </div>`:``}
        </div>
      </a>`}).join(``)}function a(){return`hsl(${Math.floor(Math.random()*360)},60%,55%)`}async function o(){try{t=(await window.api.request(`/live`)).data||[],i(t)}catch(e){console.error(`Load live rooms error:`,e),document.getElementById(`live-grid`).innerHTML=`
      <div class="empty-live">
        <div class="icon">⚠️</div>
        <h3>Couldn't load streams</h3>
        <p>Check your connection and try again.</p>
      </div>`}}async function s(){try{let e=(await window.api.request(`/stories/feed`)).data||[],t=document.getElementById(`stories-container`),n=window.CURRENT_USER.avatarUrl||window.CURRENT_USER.avatar_url||`https://ui-avatars.com/api/?name=${encodeURIComponent(window.CURRENT_USER.username||`Me`)}&background=ff3d7f&color=fff&size=80`,r=`
      <div class="story-item">
        <div class="story-add" id="add-story-btn">＋</div>
        <span>Add Story</span>
      </div>
      <div class="story-item" id="my-story-btn">
        <div class="story-ring"><img src="${window.escapeHtml(n)}" alt="Your story"></div>
        <span>You</span>
      </div>`;r+=e.map(e=>`
      <div class="story-item ${e.viewed?`viewed`:``}" data-story-id="${e.id}">
        <div class="story-ring"><img src="${window.escapeHtml(e.avatar_url||`https://i.pravatar.cc/100`)}" alt="${window.escapeHtml(e.username||``)}"></div>
        <span>${window.escapeHtml(e.username||`User`)}</span>
      </div>`).join(``),t.innerHTML=r,document.getElementById(`add-story-btn`)?.addEventListener(`click`,()=>{window.showToast(`Story creation coming soon`)}),document.getElementById(`my-story-btn`)?.addEventListener(`click`,()=>{window.showToast(`Your story`)}),t.querySelectorAll(`[data-story-id]`).forEach(e=>{e.addEventListener(`click`,()=>c(e.dataset.storyId))})}catch(e){console.error(`Load stories error:`,e)}}function c(e){window.api.request(`/stories/${e}/view`,{method:`POST`}).catch(()=>{}),window.showToast(`Story viewer coming soon`)}o(),s(),setInterval(o,3e4);