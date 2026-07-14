import"./live-B188tWM7.js";import"./app-By3Wcv2E.js";/* empty css              */var e=new Map;async function t(t){if(!t)return null;if(e.has(t))return e.get(t);try{let n=new Audio(t);return n.preload=`auto`,await new Promise((e,t)=>{n.addEventListener(`canplaythrough`,e,{once:!0}),n.addEventListener(`error`,t,{once:!0}),setTimeout(e,1500)}),e.set(t,n),n}catch(n){return console.warn(`[SoundManager] Audio failed to preload:`,t,n),e.set(t,null),null}}var n=class{constructor({masterVolume:e=.7}={}){this.masterVolume=e,this.muted=!1,this.activeNodes=new Set,this.audioPool=new Map}setMasterVolume(e){this.masterVolume=Math.max(0,Math.min(1,e)),this.activeNodes.forEach(e=>{e.volume=Math.min(e.volume,this.masterVolume)})}setMuted(e=!0){this.muted=e,e&&this.stopAll()}async play(e,{volume:n=1,fadeMs:r=150,playbackRate:i=1,loop:a=!1}={}){if(this.muted||!e)return null;let o=await t(e);if(!o)return null;let s=this._getNode(o);s.loop=a,s.currentTime=0,s.playbackRate=i,s.volume=0;let c=Math.max(0,Math.min(1,n*this.masterVolume));this.activeNodes.add(s);try{await s.play()}catch{return this.activeNodes.delete(s),null}return this._fade(s,0,c,r),s.onended=()=>{this.activeNodes.delete(s),this._returnNode(s)},s}fadeOutAndStop(e,t=200){e&&this._fade(e,e.volume,0,t,()=>{e.pause(),e.currentTime=0,this.activeNodes.delete(e),this._returnNode(e)})}stopAll(){[...this.activeNodes].forEach(e=>{this.fadeOutAndStop(e,120)})}dispose(){this.stopAll(),this.audioPool.clear(),this.activeNodes.clear()}_getNode(e){let t=e.src;this.audioPool.has(t)||this.audioPool.set(t,[]);let n=this.audioPool.get(t);return n.length?n.pop():e.cloneNode()}_returnNode(e){let t=e.src;this.audioPool.has(t)||this.audioPool.set(t,[]),this.audioPool.get(t).push(e)}_fade(e,t,n,r,i){if(!e)return;if(r<=0){e.volume=n,i?.();return}let a=performance.now(),o=s=>{let c=Math.min(1,(s-a)/r);e.volume=t+(n-t)*c,c<1?requestAnimationFrame(o):(e.volume=n,i?.())};requestAnimationFrame(o)}},r=`gift-engine-overlay-style`;function i(){if(document.getElementById(r))return;let e=document.createElement(`style`);e.id=r,e.textContent=`

#gift-engine-ui-layer{
position:fixed;
inset:0;
z-index:16;
pointer-events:none;
overflow:hidden;
font-family:Inter,Segoe UI,sans-serif;
}

.ge-dim{
position:absolute;
inset:0;
background:rgba(0,0,0,0);
backdrop-filter:blur(0px);
transition:
background .35s ease,
backdrop-filter .35s ease;
}

.ge-dim.on{
background:rgba(0,0,0,.32);
backdrop-filter:blur(2px);
}

.ge-banner{
position:absolute;
left:50%;
top:18%;
transform:translate(-50%,-18px) scale(.95);
opacity:0;
transition:
opacity .35s ease,
transform .35s ease;
text-align:center;
min-width:280px;
padding:18px 26px;
border-radius:22px;
background:linear-gradient(180deg,
rgba(255,255,255,.18),
rgba(255,255,255,.05));
border:1px solid rgba(255,255,255,.18);
backdrop-filter:blur(12px);
box-shadow:
0 18px 60px rgba(0,0,0,.35),
0 0 40px rgba(255,200,87,.18);
}

.ge-banner.show{
opacity:1;
transform:translate(-50%,0) scale(1);
}

.ge-title{
font-size:24px;
font-weight:900;
letter-spacing:.04em;
color:#FFC857;
text-shadow:
0 0 20px rgba(255,200,87,.5),
0 3px 12px rgba(0,0,0,.6);
}

.ge-sub{
margin-top:8px;
font-size:14px;
font-weight:700;
color:#fff;
}

.ge-sub em{
font-style:normal;
color:#ff4f90;
}

.ge-combo{
position:absolute;
left:50%;
top:34%;
transform:translate(-50%,0) scale(.75);
opacity:0;
font-size:38px;
font-weight:900;
color:#fff;
letter-spacing:.08em;
transition:
opacity .2s ease,
transform .2s ease;
text-shadow:
0 0 18px #ff3d7f,
0 0 40px rgba(255,61,127,.5),
0 3px 8px rgba(0,0,0,.7);
}

.ge-combo.show{
opacity:1;
transform:translate(-50%,0) scale(1);
}

.ge-toast{

position:absolute;

left:50%;

bottom:80px;

transform:translateX(-50%) translateY(30px);

padding:12px 22px;

border-radius:999px;

background:rgba(25,25,25,.82);

color:#fff;

font-size:14px;

font-weight:700;

opacity:0;

transition:
opacity .3s ease,
transform .3s ease;

box-shadow:0 10px 40px rgba(0,0,0,.35);

}

.ge-toast.show{

opacity:1;

transform:translateX(-50%) translateY(0);

}

`,document.head.appendChild(e)}var a=class{constructor(e){i(),this.layer=document.createElement(`div`),this.layer.id=`gift-engine-ui-layer`,e.appendChild(this.layer),this.dim=document.createElement(`div`),this.dim.className=`ge-dim`,this.layer.appendChild(this.dim),this.banner=document.createElement(`div`),this.banner.className=`ge-banner`,this.banner.innerHTML=`

<div class="ge-title"></div>

<div class="ge-sub"></div>

`,this.layer.appendChild(this.banner),this.comboEl=document.createElement(`div`),this.comboEl.className=`ge-combo`,this.layer.appendChild(this.comboEl),this.toast=document.createElement(`div`),this.toast.className=`ge-toast`,this.layer.appendChild(this.toast)}focusDim(e){this.dim.classList.toggle(`on`,!!e)}showBanner({sender:e,receiver:t,giftTitle:n},r=2400){this.banner.querySelector(`.ge-title`).textContent=n,this.banner.querySelector(`.ge-sub`).innerHTML=`<em>${this._esc(e)}</em> &rarr; ${this._esc(t)}`,this.banner.classList.add(`show`),clearTimeout(this.bannerTimer),this.bannerTimer=setTimeout(()=>{this.banner.classList.remove(`show`)},r)}showCombo(e){this.comboEl.textContent=`x${e} COMBO`,this.comboEl.classList.add(`show`),clearTimeout(this.comboTimer),this.comboTimer=setTimeout(()=>{this.comboEl.classList.remove(`show`)},900)}showToast(e,t=1800){this.toast.textContent=e,this.toast.classList.add(`show`),clearTimeout(this.toastTimer),this.toastTimer=setTimeout(()=>{this.toast.classList.remove(`show`)},t)}clear(){this.focusDim(!1),this.banner.classList.remove(`show`),this.comboEl.classList.remove(`show`),this.toast.classList.remove(`show`)}destroy(){this.layer.remove()}_esc(e){return String(e||``).replace(/[&<>"]/g,e=>({"&":`&amp;`,"<":`&lt;`,">":`&gt;`,'"':`&quot;`})[e])}},o=1500,s=[2,5,10,20,50,100],c=class e{constructor(){this.active=new Map,this.highestCombo=0}_key(e){return`${e.senderId||e.sender}:${e.giftKey}`}register(t,n,r,i){let a=this._key(t),s=this.active.get(a);if(s)return s.count+=t.quantity||1,s.lastItem=t,s.updatedAt=Date.now(),clearTimeout(s.timer),this.highestCombo=Math.max(this.highestCombo,s.count),r?.({...s.lastItem,comboCount:s.count,comboStep:e.nearestStep(s.count),progress:e.progress(s.count)}),s.timer=setTimeout(()=>{this.active.delete(a),i?.({...s.lastItem,comboCount:s.count,comboStep:e.nearestStep(s.count)})},o),{type:`merged`,count:s.count,step:e.nearestStep(s.count)};let c={count:t.quantity||1,lastItem:t,createdAt:Date.now(),updatedAt:Date.now(),timer:null};return c.timer=setTimeout(()=>{this.active.delete(a),i?.({...c.lastItem,comboCount:c.count,comboStep:e.nearestStep(c.count)})},o),this.active.set(a,c),this.highestCombo=Math.max(this.highestCombo,c.count),n?.(t),{type:`new`,item:t,count:c.count,step:e.nearestStep(c.count)}}clear(){this.active.forEach(e=>{clearTimeout(e.timer)}),this.active.clear()}resetSender(e){for(let[t,n]of this.active.entries())t.startsWith(`${e}:`)&&(clearTimeout(n.timer),this.active.delete(t))}getActiveCombos(){return[...this.active.values()].map(e=>({count:e.count,item:e.lastItem}))}get size(){return this.active.size}static nearestStep(e){let t=0;for(let n of s)e>=n&&(t=n);return t||e}static progress(e){let t=0,n=s[s.length-1];for(let r of s){if(e<r){n=r;break}t=r}return e>=n?1:(e-t)/(n-t)}dispose(){this.clear()}},l=class{constructor({onPlayPremium:e,onPlayBasic:t,onQueueStart:n,onQueueEnd:r,onQueueChanged:i,maxQueueLength:a=40}){this.onPlayPremium=e,this.onPlayBasic=t,this.onQueueStart=n,this.onQueueEnd=r,this.onQueueChanged=i,this.maxQueueLength=a,this.queue=[],this.playing=!1,this.paused=!1,this.comboMap=new Map}push(e){if(e){if(e.tierInfo.allowOverlap){this._trackCombo(e);try{this.onPlayBasic?.(e)}catch(e){console.error(e)}return}this.queue.push(e),this.queue.sort((e,t)=>t.tierInfo.priority===e.tierInfo.priority?(e.timestamp||Date.now())-(t.timestamp||Date.now()):t.tierInfo.priority-e.tierInfo.priority),this.queue.length>this.maxQueueLength&&(this.queue.length=this.maxQueueLength),this.onQueueChanged?.(this.queue.length),this._tryPlayNext()}}async _tryPlayNext(){if(this.paused||this.playing)return;if(!this.queue.length){this.onQueueEnd?.();return}this.playing=!0,this.onQueueStart?.();let e=this.queue.shift();this.onQueueChanged?.(this.queue.length);try{await this.onPlayPremium?.(e)}catch(e){console.error(`[QueueManager]`,e)}finally{this.playing=!1,this._tryPlayNext()}}_trackCombo(e){let t=`${e.senderId||e.sender}-${e.receiverId||e.receiver}-${e.giftName}`,n=this.comboMap.get(t)||{count:0,timer:null};n.count++,clearTimeout(n.timer),n.timer=setTimeout(()=>{this.comboMap.delete(t)},3e3),this.comboMap.set(t,n),e.comboCount=n.count}pause(){this.paused=!0}resume(){this.paused=!1,this._tryPlayNext()}clear(){this.queue.length=0,this.onQueueChanged?.(0)}cancel(e){this.queue=this.queue.filter(t=>!e(t)),this.onQueueChanged?.(this.queue.length)}get pending(){return this.queue.length}get isBusy(){return this.playing}},u=900,d={sparkles:`circle`,petals:`petal`,hearts:`heart`,trailDots:`circle`,lipTrail:`petal`,goldSparkles:`circle`,diamondSparkle:`circle`,rainbowShards:`triangle`,confetti:`rect`,goldStars:`star`,smokeTrail:`circle`,waterSplash:`circle`,cloudTrail:`circle`,fireworks:`circle`},f=[`#ff3d7f`,`#ffc857`,`#00d9b5`,`#b38aff`,`#3d9bff`],p=[`#ff3d7f`,`#ffc857`,`#3d9bff`,`#6dff8a`,`#b38aff`],m=class{constructor(e){this.canvas=document.createElement(`canvas`),this.canvas.style.cssText=`position:absolute; inset:0; width:100%; height:100%; pointer-events:none;`,e.appendChild(this.canvas),this.ctx=this.canvas.getContext(`2d`),this.dpr=Math.min(window.devicePixelRatio||1,2),this._resizeHandler=()=>this.resize(),window.addEventListener(`resize`,this._resizeHandler),this.resize(),this.particles=[];for(let e=0;e<u;e++)this.particles.push({active:!1,x:0,y:0,vx:0,vy:0,life:0,maxLife:0,size:0,color:`#fff`,shape:`circle`,rotation:0,vr:0,gravity:.05,drag:.98});this.cursor=0,this._running=!0,this._clock=performance.now(),this._loop()}resize(){let e=window.innerWidth,t=window.innerHeight;this.canvas.width=e*this.dpr,this.canvas.height=t*this.dpr,this.canvas.style.width=e+`px`,this.canvas.style.height=t+`px`,this.ctx.setTransform(this.dpr,0,0,this.dpr,0,0)}burst({x:e,y:t,preset:n=`sparkles`,color:r=`#ffffff`,count:i=40}){let a=d[n]||`circle`,o=n===`smokeTrail`||n===`cloudTrail`,s=n===`waterSplash`,c=n===`confetti`,l=n===`fireworks`,m=n===`rainbowShards`;for(let n=0;n<i;n++){let d=this.particles[this.cursor];this.cursor=(this.cursor+1)%u,d.active=!0,d.x=e+(Math.random()-.5)*24,d.y=t+(Math.random()-.5)*24;let h=l?n/i*Math.PI*2+Math.random()*.2:Math.random()*Math.PI*2,g=o?.4+Math.random()*.6:l?2.5+Math.random()*2.5:1+Math.random()*3;d.vx=Math.cos(h)*g,d.vy=Math.sin(h)*g-(o?1.2:.5),d.gravity=o?-.008:s?.14:.06,d.drag=o?.985:.97,d.size=c?4+Math.random()*4:o?10+Math.random()*14:2.5+Math.random()*3.5,d.rotation=Math.random()*Math.PI*2,d.vr=(Math.random()-.5)*.25,d.maxLife=o?1.3+Math.random():.65+Math.random()*.85,d.life=d.maxLife,d.shape=a,d.color=c?f[Math.random()*f.length|0]:m?p[Math.random()*p.length|0]:r}}update(e){for(let t of this.particles)if(t.active){if(t.life-=e,t.life<=0){t.active=!1;continue}t.vx*=t.drag,t.vy*=t.drag,t.vy+=t.gravity*e*10,t.x+=t.vx*e*60*.5,t.y+=t.vy*e*60*.5,t.rotation+=t.vr}}draw(){let e=this.ctx;e.clearRect(0,0,this.canvas.width,this.canvas.height);for(let t of this.particles){if(!t.active)continue;let n=Math.max(0,t.life/t.maxLife);switch(e.save(),e.globalAlpha=n,e.translate(t.x,t.y),e.rotate(t.rotation),e.fillStyle=t.color,t.shape){case`petal`:e.beginPath(),e.ellipse(0,0,t.size,t.size*1.7,0,0,Math.PI*2),e.fill();break;case`heart`:this._drawHeart(e,t.size);break;case`rect`:e.fillRect(-t.size/2,-t.size/2,t.size,t.size*.6);break;case`triangle`:e.beginPath(),e.moveTo(0,-t.size),e.lineTo(t.size,t.size),e.lineTo(-t.size,t.size),e.closePath(),e.fill();break;case`star`:this._drawStar(e,t.size);break;default:e.beginPath(),e.arc(0,0,t.size,0,Math.PI*2),e.fill()}e.restore()}}_drawHeart(e,t){e.beginPath(),e.moveTo(0,t*.6),e.bezierCurveTo(0,0,-t,0,-t,-t*.4),e.bezierCurveTo(-t,-t,0,-t,0,-t*.3),e.bezierCurveTo(0,-t,t,-t,t,-t*.4),e.bezierCurveTo(t,0,0,0,0,t*.6),e.fill()}_drawStar(e,t){e.beginPath();for(let n=0;n<8;n++){let r=n%2==0?t:t*.4,i=n/8*Math.PI*2;e.lineTo(Math.cos(i)*r,Math.sin(i)*r)}e.closePath(),e.fill()}clear(){for(let e of this.particles)e.active=!1;this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height)}_loop(){if(!this._running)return;requestAnimationFrame(()=>this._loop());let e=performance.now(),t=Math.min((e-this._clock)/1e3,.05);this._clock=e,this.update(t),this.draw()}dispose(){this._running=!1,window.removeEventListener(`resize`,this._resizeHandler),this.canvas.remove()}},h=3;function g(e,t){let n=document.createElement(`span`);return n.textContent=e||`🎁`,n.style.cssText=`
    font-size:${Math.round(t*.72)}px;
    line-height:1;
    display:block;
    text-rendering:optimizeLegibility;
  `,n}function _(e){return`drop-shadow(0 0 14px ${e}cc) drop-shadow(0 0 28px ${e}66) contrast(1.08) saturate(1.15)`}function v(e,t,n){let r=e.naturalWidth,i=e.naturalHeight;if(!r||!i)return null;let a=Math.min(window.devicePixelRatio||1,h),o=Math.max(1,Math.round(t*a)),s=document.createElement(`canvas`);s.width=o,s.height=o,s.style.cssText=`
    width:${t}px;
    height:${t}px;
    display:block;
    filter:${_(n)};
  `;let c=s.getContext(`2d`);c.imageSmoothingEnabled=!0,c.imageSmoothingQuality=`high`;let l=Math.min(o/r,o/i),u=r*l,d=i*l,f=(o-u)/2,p=(o-d)/2;return c.clearRect(0,0,o,o),c.drawImage(e,f,p,u,d),s}function y(e){switch(e){case`flyInGrow`:return{frames:[{transform:`translate3d(-160%,-50%,0) rotate(-25deg) scale3d(.4,.4,1)`,opacity:0},{transform:`translate3d(-50%,-50%,0) rotate(0deg) scale3d(1.15,1.15,1)`,opacity:1,offset:.35},{transform:`translate3d(-50%,-62%,0) rotate(4deg) scale3d(1,1,1)`,opacity:1,offset:.75},{transform:`translate3d(-50%,-92%,0) rotate(0deg) scale3d(.85,.85,1)`,opacity:0}]};case`pulseFloat`:return{frames:[{transform:`translate3d(-50%,-50%,0) scale3d(.5,.5,1)`,opacity:0},{transform:`translate3d(-50%,-50%,0) scale3d(1.25,1.25,1)`,opacity:1,offset:.2},{transform:`translate3d(-50%,-55%,0) scale3d(1,1,1)`,opacity:1,offset:.4},{transform:`translate3d(-50%,-60%,0) scale3d(1.15,1.15,1)`,opacity:1,offset:.6},{transform:`translate3d(-50%,-92%,0) scale3d(.9,.9,1)`,opacity:0}]};case`bounceScale`:return{frames:[{transform:`translate3d(-50%,-30%,0) scale3d(.3,.3,1)`,opacity:0},{transform:`translate3d(-50%,-55%,0) scale3d(1.3,1.3,1)`,opacity:1,offset:.3},{transform:`translate3d(-50%,-48%,0) scale3d(.9,.9,1)`,opacity:1,offset:.5},{transform:`translate3d(-50%,-70%,0) scale3d(1.05,1.05,1)`,opacity:1,offset:.7},{transform:`translate3d(-50%,-96%,0) scale3d(.8,.8,1)`,opacity:0}]};case`flyAcrossTilt`:return{frames:[{transform:`translate3d(-220%,-50%,0) rotate(-15deg) scale3d(.7,.7,1)`,opacity:0},{transform:`translate3d(-50%,-50%,0) rotate(6deg) scale3d(1.1,1.1,1)`,opacity:1,offset:.4},{transform:`translate3d(60%,-56%,0) rotate(-4deg) scale3d(1,1,1)`,opacity:1,offset:.75},{transform:`translate3d(140%,-60%,0) rotate(0deg) scale3d(.9,.9,1)`,opacity:0}]};case`spin3d`:return{frames:[{transform:`translate3d(-50%,-50%,0) scale3d(.3,.3,1) rotateY(0deg)`,opacity:0},{transform:`translate3d(-50%,-50%,0) scale3d(1.2,1.2,1) rotateY(360deg)`,opacity:1,offset:.5},{transform:`translate3d(-50%,-50%,0) scale3d(1,1,1) rotateY(720deg)`,opacity:1,offset:.85},{transform:`translate3d(-50%,-50%,0) scale3d(.9,.9,1) rotateY(760deg)`,opacity:0}],easing:`ease-in-out`};case`jumpSpin`:return{frames:[{transform:`translate3d(-50%,10%,0) scale3d(.5,.5,1) rotate(0deg)`,opacity:0},{transform:`translate3d(-50%,-70%,0) scale3d(1.1,1.1,1) rotate(180deg)`,opacity:1,offset:.35},{transform:`translate3d(-50%,-40%,0) scale3d(1,1,1) rotate(360deg)`,opacity:1,offset:.6},{transform:`translate3d(-50%,-55%,0) scale3d(1.05,1.05,1) rotate(360deg)`,opacity:1,offset:.8},{transform:`translate3d(-50%,-92%,0) scale3d(.85,.85,1) rotate(360deg)`,opacity:0}]};case`bloomScale`:return{frames:[{transform:`translate3d(-50%,-50%,0) scale3d(0,0,1) rotate(-8deg)`,opacity:0},{transform:`translate3d(-50%,-50%,0) scale3d(1.2,1.2,1) rotate(4deg)`,opacity:1,offset:.4},{transform:`translate3d(-50%,-56%,0) scale3d(1,1,1) rotate(-2deg)`,opacity:1,offset:.7},{transform:`translate3d(-50%,-88%,0) scale3d(.85,.85,1) rotate(0deg)`,opacity:0}]};case`spinShine`:return{frames:[{transform:`translate3d(-50%,-50%,0) scale3d(.4,.4,1) rotate(0deg)`,opacity:0,filter:`brightness(1)`},{transform:`translate3d(-50%,-50%,0) scale3d(1.25,1.25,1) rotate(180deg)`,opacity:1,offset:.4,filter:`brightness(1.9)`},{transform:`translate3d(-50%,-50%,0) scale3d(1,1,1) rotate(360deg)`,opacity:1,offset:.7,filter:`brightness(1.2)`},{transform:`translate3d(-50%,-82%,0) scale3d(.9,.9,1) rotate(400deg)`,opacity:0,filter:`brightness(1)`}]};case`popIn`:return{frames:[{transform:`translate3d(-50%,-50%,0) scale3d(0,0,1)`,opacity:0},{transform:`translate3d(-50%,-50%,0) scale3d(1.25,1.25,1)`,opacity:1,offset:.3},{transform:`translate3d(-50%,-50%,0) scale3d(.95,.95,1) rotate(-4deg)`,opacity:1,offset:.5},{transform:`translate3d(-50%,-50%,0) scale3d(1.05,1.05,1) rotate(3deg)`,opacity:1,offset:.7},{transform:`translate3d(-50%,-82%,0) scale3d(.9,.9,1) rotate(0deg)`,opacity:0}]};case`floatBob`:return{frames:[{transform:`translate3d(-50%,10%,0) scale3d(.5,.5,1)`,opacity:0},{transform:`translate3d(-50%,-50%,0) scale3d(1.15,1.15,1)`,opacity:1,offset:.22},{transform:`translate3d(-50%,-58%,0) scale3d(1,1,1) rotate(-3deg)`,opacity:1,offset:.42},{transform:`translate3d(-50%,-48%,0) scale3d(1,1,1) rotate(3deg)`,opacity:1,offset:.62},{transform:`translate3d(-50%,-56%,0) scale3d(1,1,1) rotate(0deg)`,opacity:1,offset:.84},{transform:`translate3d(-50%,-82%,0) scale3d(.9,.9,1)`,opacity:0}]};case`driveAcross`:return{frames:[{transform:`translate3d(-240%,-50%,0) scale3d(.9,.9,1) skewX(-6deg)`,opacity:0},{transform:`translate3d(-50%,-50%,0) scale3d(1.1,1.1,1) skewX(-3deg)`,opacity:1,offset:.15},{transform:`translate3d(60%,-50%,0) scale3d(1.05,1.05,1) skewX(-3deg)`,opacity:1,offset:.7},{transform:`translate3d(240%,-50%,0) scale3d(1,1,1) skewX(-6deg)`,opacity:0}],easing:`cubic-bezier(.2,.7,.3,1)`};case`sailAcross`:return{frames:[{transform:`translate3d(-220%,-40%,0) scale3d(.8,.8,1)`,opacity:0},{transform:`translate3d(-50%,-52%,0) scale3d(1.05,1.05,1)`,opacity:1,offset:.2},{transform:`translate3d(0%,-42%,0) scale3d(1,1,1)`,opacity:1,offset:.5},{transform:`translate3d(60%,-52%,0) scale3d(1,1,1)`,opacity:1,offset:.75},{transform:`translate3d(220%,-42%,0) scale3d(.9,.9,1)`,opacity:0}]};case`flyAcross`:return{frames:[{transform:`translate3d(-200%,60%,0) rotate(-18deg) scale3d(.7,.7,1)`,opacity:0},{transform:`translate3d(-40%,-20%,0) rotate(-10deg) scale3d(1.1,1.1,1)`,opacity:1,offset:.35},{transform:`translate3d(40%,-70%,0) rotate(-6deg) scale3d(1,1,1)`,opacity:1,offset:.7},{transform:`translate3d(200%,-130%,0) rotate(-4deg) scale3d(.85,.85,1)`,opacity:0}]};case`riseUp`:return{frames:[{transform:`translate3d(-50%,80%,0) scale3d(.6,.6,1)`,opacity:0},{transform:`translate3d(-50%,-10%,0) scale3d(1.1,1.1,1)`,opacity:1,offset:.4},{transform:`translate3d(-50%,-45%,0) scale3d(1,1,1)`,opacity:1,offset:.7},{transform:`translate3d(-50%,-55%,0) scale3d(1,1,1)`,opacity:1,offset:.88},{transform:`translate3d(-50%,-72%,0) scale3d(.92,.92,1)`,opacity:0}]};case`expandPulse`:return{frames:[{transform:`translate3d(-50%,-50%,0) scale3d(.2,.2,1)`,opacity:0},{transform:`translate3d(-50%,-50%,0) scale3d(1.4,1.4,1)`,opacity:1,offset:.35},{transform:`translate3d(-50%,-50%,0) scale3d(1,1,1)`,opacity:1,offset:.55},{transform:`translate3d(-50%,-50%,0) scale3d(1.2,1.2,1)`,opacity:1,offset:.75},{transform:`translate3d(-50%,-50%,0) scale3d(1.5,1.5,1)`,opacity:0}]};default:return{frames:[{transform:`translate3d(-50%,-50%,0) scale3d(.3,.3,1)`,opacity:0},{transform:`translate3d(-50%,-50%,0) scale3d(1.2,1.2,1)`,opacity:1,offset:.4},{transform:`translate3d(-50%,-70%,0) scale3d(1,1,1)`,opacity:1,offset:.7},{transform:`translate3d(-50%,-92%,0) scale3d(.85,.85,1)`,opacity:0}]}}}function b({rootEl:e,particles:t,iconUrl:n,emoji:r,animation:i=`popGlow`,color:a=`#ffffff`,particlePreset:o=`sparkles`,durationMs:s=2e3,sizePx:c=140,basic:l=!1}){return new Promise(u=>{let d=document.createElement(`div`);d.style.cssText=`
      position:absolute;
      will-change:transform,opacity;
      pointer-events:none;
      display:flex;
      align-items:center;
      justify-content:center;
      perspective:600px;
      backface-visibility:hidden;
    `;let f,p=!1;if(n){f=document.createElement(`img`),f.decoding=`sync`,f.loading=`eager`,f.src=n,f.alt=``,f.style.cssText=`
        width:${c}px;
        height:${c}px;
        object-fit:contain;
        filter:${_(a)};
        display:block;
      `;let e=()=>{if(p)return;let e=v(f,c,a);e&&(p=!0,f.replaceWith(e),f=e)};f.complete&&f.naturalWidth?e():f.addEventListener(`load`,e,{once:!0}),f.addEventListener(`error`,()=>{let e=g(r,c);e.style.filter=_(a),f.replaceWith(e),f=e},{once:!0})}else f=g(r,c),f.style.filter=_(a);d.appendChild(f);let m=window.innerWidth,h=window.innerHeight,b,x;l?(b=24+Math.random()*(m-48),x=h-130):(b=m/2,x=h*.42),b=Math.round(b),x=Math.round(x),d.style.left=`${b}px`,d.style.top=`${x}px`,d.style.transform=`translate3d(-50%,-50%,0)`,e.appendChild(d),t.burst({x:b,y:x,preset:o,color:a,count:l?18:60});let S=null;l||(S=setTimeout(()=>{t.burst({x:b,y:x,preset:o,color:a,count:80})},s*.5));let{frames:C,easing:w}=y(i),T=d.animate(C,{duration:s,easing:w||`ease-out`,fill:`forwards`}),E=()=>{S&&clearTimeout(S),d.remove(),u()};T.onfinish=E,T.oncancel=E})}var x={basic:{priority:1,durationMs:1700,allowOverlap:!0},premium:{priority:5,durationMs:4200,allowOverlap:!1},legendary:{priority:10,durationMs:6e3,allowOverlap:!1}},S={tier:`basic`,animation:`popGlow`,particle:`sparkles`,color:`#ffffff`,sound:null};function C(e){let t=x[e.tier]||x.basic;return{...S,...e,tierInfo:t}}var w={rose:C({tier:`basic`,animation:`flyInGrow`,particle:`petals`,color:`#ff3d7f`,sound:`/assets/gifts/sounds/rose.mp3`}),heart:C({tier:`basic`,animation:`pulseFloat`,particle:`hearts`,color:`#ff4d8d`,sound:`/assets/gifts/sounds/heart.mp3`}),like:C({tier:`basic`,animation:`bounceScale`,particle:`trailDots`,color:`#3d9bff`}),kiss:C({tier:`basic`,animation:`flyAcrossTilt`,particle:`lipTrail`,color:`#ff75a8`,sound:`/assets/gifts/sounds/kiss.mp3`}),"golden love":C({tier:`premium`,animation:`spin3d`,particle:`goldSparkles`,color:`#ffc857`,sound:`/assets/gifts/sounds/golden-love.mp3`}),"teddy bear":C({tier:`premium`,animation:`jumpSpin`,particle:`hearts`,color:`#c98a4b`}),bouquet:C({tier:`premium`,animation:`bloomScale`,particle:`petals`,color:`#ff82b9`}),"diamond ring":C({tier:`premium`,animation:`spinShine`,particle:`diamondSparkle`,color:`#ffe9a8`,sound:`/assets/gifts/sounds/ring.mp3`}),diamond:C({tier:`premium`,animation:`spinShine`,particle:`rainbowShards`,color:`#9ff0ff`}),"birthday cake":C({tier:`premium`,animation:`popIn`,particle:`confetti`,color:`#ffd479`,sound:`/assets/gifts/sounds/birthday.mp3`}),crown:C({tier:`legendary`,animation:`floatBob`,particle:`goldStars`,color:`#ffd479`}),"sports car":C({tier:`legendary`,animation:`driveAcross`,particle:`smokeTrail`,color:`#ff3d3d`}),yacht:C({tier:`legendary`,animation:`sailAcross`,particle:`waterSplash`,color:`#9fd8ff`}),"private jet":C({tier:`legendary`,animation:`flyAcross`,particle:`cloudTrail`,color:`#dfe8ff`}),castle:C({tier:`legendary`,animation:`riseUp`,particle:`fireworks`,color:`#ffd479`}),fireworks:C({tier:`legendary`,animation:`expandPulse`,particle:`fireworks`,color:`#ffe9a8`,sound:`/assets/gifts/sounds/fireworks.mp3`})};function T(e){return w[String(e||``).trim().toLowerCase()]||C(S)}window.__giftEngine=new class{constructor(e,{maxBasicConcurrent:t=14}={}){if(!e)throw Error(`GiftAnimationManager requires a root element`);this.rootEl=e,this.rootEl.style.cssText=`
            position:fixed;
            inset:0;
            pointer-events:none;
            z-index:15;
            overflow:hidden;
        `,this.reducedMotion=window.matchMedia(`(prefers-reduced-motion: reduce)`).matches,this.particles=new m(e),this.sound=new n,this.ui=new a(e),this.combo=new c,this.basicActiveCount=0,this.maxBasicConcurrent=t,this.totalAnimationsPlayed=0,this.queue=new l({onPlayPremium:e=>this._playFeatured(e),onPlayBasic:e=>this._playBasic(e),onQueueStart:()=>{this.queueRunning=!0},onQueueEnd:()=>{this.queueRunning=!1}})}playGift(e={}){try{let t=e.giftName||e.name||e.gift?.name||`Gift`,n=T(t),r={sender:e.senderName||e.name||`Someone`,senderId:e.senderId||e.sender_id,receiver:e.receiverName||e.receiver||`Host`,receiverId:e.receiverId||e.receiver_id,avatar:e.avatar,giftKey:t.toLowerCase(),giftTitle:t,giftIcon:e.giftIcon||e.iconUrl||e.icon_url||null,giftEmoji:e.giftEmoji||`🎁`,quantity:e.quantity||1,amount:e.amount||0,timestamp:Date.now(),cfg:n,tierInfo:n.tierInfo};if(r.tierInfo.allowOverlap){this.queue.push(r);return}let i=this.combo.register(r,e=>{this.queue.push({...e,isComboFinal:!0})});i&&i.type===`merged`&&this.ui.showCombo(i.count)}catch(e){console.error(`[GiftAnimationManager] playGift error:`,e)}}playMany(e=[]){Array.isArray(e)&&e.forEach(e=>{this.playGift(e)})}clearQueue(){this.queue.clear()}pauseQueue(){this.queue.pause()}resumeQueue(){this.queue.resume()}get pendingQueue(){return this.queue.pending}get isBusy(){return this.queue.isBusy}async _playBasic(e){if(this.basicActiveCount>=this.maxBasicConcurrent)return;this.basicActiveCount++,this.totalAnimationsPlayed++,e.cfg.sound&&this.sound.play(e.cfg.sound,{volume:.6,fadeMs:80});let t=this.reducedMotion?500:e.tierInfo.durationMs;try{await b({rootEl:this.rootEl,particles:this.particles,iconUrl:e.giftIcon,emoji:e.giftEmoji,animation:this.reducedMotion?`popGlow`:e.cfg.animation,color:e.cfg.color,particlePreset:e.cfg.particle,durationMs:t,sizePx:84,basic:!0})}finally{this.basicActiveCount--}}async _playFeatured(e){this.totalAnimationsPlayed++;let t=e.comboCount||e.quantity||1,n=this.reducedMotion?1200:e.tierInfo.durationMs,r=Math.min(300,160+Math.min(t,100)*.65);this.ui.focusDim(!0),this.ui.showBanner({sender:e.sender,receiver:e.receiver,giftTitle:e.giftTitle}),t>=s[0]&&this.ui.showCombo(t),e.cfg.sound&&this.sound.play(e.cfg.sound,{volume:e.tierInfo.priority>=10?1:.85}),await b({rootEl:this.rootEl,particles:this.particles,iconUrl:e.giftIcon,emoji:e.giftEmoji,animation:this.reducedMotion?`popGlow`:e.cfg.animation,color:e.cfg.color,particlePreset:e.cfg.particle,durationMs:n,sizePx:r,basic:!1}),this.ui.focusDim(!1)}setMuted(e=!0){this.sound.setMuted(e)}setMasterVolume(e=1){this.sound.setMasterVolume(e)}resize(){this.particles?.resize()}stopAll(){this.sound.stopAll(),this.queue.clear(),this.particles?.clear(),this.ui.focusDim(!1)}getStats(){return{totalAnimationsPlayed:this.totalAnimationsPlayed,activeBasicAnimations:this.basicActiveCount,pendingQueue:this.queue.pending,queueBusy:this.queue.isBusy,reducedMotion:this.reducedMotion}}destroy(){try{this.stopAll(),this.particles?.dispose(),this.ui?.destroy()}catch(e){console.warn(`[GiftAnimationManager] destroy:`,e)}}}(document.getElementById(`gift-engine-root`));