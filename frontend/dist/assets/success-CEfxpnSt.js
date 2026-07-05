import"./app-C0dFVt1v.js";/* empty css              */var e=new URLSearchParams(window.location.search),t=e.get(`tx_ref`),n=e.get(`status`);console.log(`[flw-success] tx_ref:`,t,`status param:`,n);var r=document.getElementById(`result-screen`);function i(){r.innerHTML=`
      <div class="result-spinner"></div>
      <div class="result-title">Confirming your payment…</div>
      <div class="result-sub">This usually takes just a few seconds. Please don't close this page.</div>
      ${t?`<div class="result-ref">Ref: ${t}</div>`:``}
    `}function a(e){r.innerHTML=`
      <div class="result-icon success">✅</div>
      <div class="result-title">Payment successful!</div>
      <div class="result-sub">${e?`${e} coins have been added to your balance.`:`Your coins have been added to your balance.`}</div>
      <a class="result-btn" href="/coins.html">Back to Wallet</a>
      ${t?`<div class="result-ref">Ref: ${t}</div>`:``}
    `}function o(e){r.innerHTML=`
      <div class="result-icon failed">✕</div>
      <div class="result-title">Payment failed</div>
      <div class="result-sub">${e||`Your payment could not be confirmed. If you were charged, contact support with the reference below.`}</div>
      <a class="result-btn" href="/coins.html">Try Again</a>
      ${t?`<div class="result-ref">Ref: ${t}</div>`:``}
    `}function s(){r.innerHTML=`
      <div class="result-icon failed">?</div>
      <div class="result-title">Missing payment reference</div>
      <div class="result-sub">We couldn't find a payment reference in this link. If you completed a payment, check your wallet balance or transaction history.</div>
      <a class="result-btn" href="/coins.html">Back to Wallet</a>
    `}async function c(e=0){if(!t){s();return}if(n===`cancelled`){o(`Payment was cancelled.`);return}if(requireAuthOrRedirect())try{let n=(await window.api.request(`/payments/flutterwave/status/${t}`)).data;if(console.log(`[flw-success] status check:`,n?.status),n.status===`success`){await refreshCurrentUser().catch(()=>{}),a(n.coins_credited);return}if(n.status===`failed`){o();return}e<10?(i(),setTimeout(()=>c(e+1),3e3)):r.innerHTML=`
          <div class="result-icon pending">⏳</div>
          <div class="result-title">Still confirming…</div>
          <div class="result-sub">This is taking longer than usual. Your coins will be added automatically once confirmed — check your wallet in a moment.</div>
          <a class="result-btn" href="/coins.html">Go to Wallet</a>
          <div class="result-ref">Ref: ${t}</div>
        `}catch(t){console.error(`[flw-success] status check failed:`,t),e<10?setTimeout(()=>c(e+1),3e3):o(`Could not confirm payment status. Check your wallet or contact support.`)}}c();