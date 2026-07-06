import"./app-By3Wcv2E.js";/* empty css              */if(!window.requireAuthOrRedirect())throw Error(`Auth required`);document.getElementById(`coin-balance`).textContent=window.formatCoins(window.CURRENT_USER.coinBalance||window.CURRENT_USER.coin_balance||0);var e=[[`rgba(255,61,127,.7)`,`rgba(120,0,255,.5)`],[`rgba(0,217,181,.65)`,`rgba(0,100,255,.5)`],[`rgba(255,160,0,.65)`,`rgba(255,61,127,.5)`],[`rgba(100,0,255,.65)`,`rgba(0,217,181,.5)`],[`rgba(0,180,255,.6)`,`rgba(0,60,180,.5)`],[`rgba(255,80,80,.65)`,`rgba(200,0,100,.5)`]],t=[];document.getElementById(`filter-tabs`).addEventListener(`click`,e=>{let r=e.target.closest(`.filter-tab`);r&&(r.dataset.filter,document.querySelectorAll(`.filter-tab`).forEach(e=>e.classList.remove(`active`)),r.classList.add(`active`),n(t))}),document.getElementById(`coin-pill-btn`).addEventListener(`click`,()=>{window.location.href=`coins.html`}),document.getElementById(`notif-btn`).addEventListener(`click`,()=>{window.showToast(`No new notifications`)}),document.getElementById(`add-story-btn`).addEventListener(`click`,()=>{window.showToast(`Story creation coming soon`)}),document.getElementById(`promo-topup-btn`).addEventListener(`click`,()=>{window.location.href=`coins.html`});function n(t){let n=document.getElementById(`live-grid`),i=document.getElementById(`live-count`);if(i.textContent=t.length?`${t.length} live`:`No live`,!t.length){n.innerHTML=`
      <div class="empty-live">
        <div class="icon">📡</div>
        <h3>Nobody's live right now</h3>
        <p>Be the first to go live and grow your audience.</p>
      </div>`;return}n.innerHTML=t.map((t,n)=>{let i=t.id;if(!i)return``;let a=e[n%e.length],o=t.avatar_url||``,s=t.cover_image_url||t.cover_image||o,c=t.username||t.display_name||`Host`,l=t.title||`Live Stream`,u=t.viewer_count||0,d=c.split(` `).map(e=>e[0]||``).join(``).slice(0,2).toUpperCase(),f=s.trim().length>0;return`
      <a class="live-card" href="live.html?room=${encodeURIComponent(i)}"
         style="--card-color-a:${a[0]};--card-color-b:${a[1]};">
        <div class="card-bg-gradient"></div>
        ${f?``:`<div class="card-initials">${window.escapeHtml(d)}</div>`}
        ${f?`<img class="card-host-photo" src="${window.escapeHtml(s)}" alt="" loading="lazy">`:``}
        <div class="card-scrim"></div>
        <span class="live-badge"><span class="pulse"></span>LIVE</span>
        <span class="viewer-chip-card">👁 ${window.formatCoins(u)}</span>
        <div class="card-info">
          <div class="card-host-row">
            <span class="card-host-live-dot"></span>
            <span class="card-host-name">${window.escapeHtml(c)}</span>
          </div>
          <div class="card-title">${window.escapeHtml(l)}</div>
          ${u>1?`
          <div class="card-watchers">
            ${[...Array(Math.min(3,u))].map(()=>`<div class="card-watcher-dot" style="background:${r()}"></div>`).join(``)}
            <span class="card-watchers-label">${u>3?`+${u-3} watching`:`watching`}</span>
          </div>`:``}
        </div>
      </a>`}).join(``)}function r(){return`hsl(${Math.floor(Math.random()*360)},60%,55%)`}async function i(){try{t=(await window.api.request(`/live`)).data||[],n(t)}catch(e){console.error(`Load live rooms error:`,e),document.getElementById(`live-grid`).innerHTML=`
      <div class="empty-live">
        <div class="icon">⚠️</div>
        <h3>Couldn't load streams</h3>
        <p>Check your connection and try again.</p>
      </div>`}}async function a(){try{let e=(await window.api.request(`/stories/feed`)).data||[],t=document.getElementById(`stories-container`),n=window.CURRENT_USER.avatarUrl||window.CURRENT_USER.avatar_url||`https://ui-avatars.com/api/?name=${encodeURIComponent(window.CURRENT_USER.username||`Me`)}&background=ff3d7f&color=fff&size=80`,r=`
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
      </div>`).join(``),t.innerHTML=r,document.getElementById(`add-story-btn`)?.addEventListener(`click`,()=>{window.showToast(`Story creation coming soon`)}),document.getElementById(`my-story-btn`)?.addEventListener(`click`,()=>{window.showToast(`Your story`)}),t.querySelectorAll(`[data-story-id]`).forEach(e=>{e.addEventListener(`click`,()=>o(e.dataset.storyId))})}catch(e){console.error(`Load stories error:`,e)}}function o(e){window.api.request(`/stories/${e}/view`,{method:`POST`}).catch(()=>{}),window.showToast(`Story viewer coming soon`)}i(),a(),setInterval(i,3e4);