function loadCollapseCss(){
  const href='mcassist-collapse.css';
  const exists=[...document.querySelectorAll('link[rel="stylesheet"]')].some(l=>(l.getAttribute('href')||'').includes(href));
  if(exists)return;
  const link=document.createElement('link');
  link.rel='stylesheet';
  link.href=href+'?v=collapse-2';
  document.head.appendChild(link);
}

function createCollapseControls(){
  loadCollapseCss();
  import('./rota-review.js?v=review-1').catch(console.error);
  const panel=document.querySelector('.ai-panel');
  if(!panel||panel.dataset.collapseReady==='1')return;
  panel.dataset.collapseReady='1';

  const close=document.createElement('button');
  close.className='ai-collapse-btn';
  close.type='button';
  close.title='Collapse McAssist';
  close.setAttribute('aria-label','Collapse McAssist');
  close.textContent='−';
  panel.appendChild(close);

  const open=document.createElement('button');
  open.className='ai-open-bubble';
  open.type='button';
  open.title='Open McAssist';
  open.setAttribute('aria-label','Open McAssist');

  const badge=document.createElement('span');
  badge.textContent='A';
  const label=document.createElement('span');
  label.textContent='McAssist';
  open.appendChild(badge);
  open.appendChild(label);
  document.body.appendChild(open);

  const saved=localStorage.getItem('mcassist_collapsed')==='1';
  document.body.classList.toggle('ai-collapsed',saved);

  close.addEventListener('click',()=>{
    document.body.classList.add('ai-collapsed');
    localStorage.setItem('mcassist_collapsed','1');
  });

  open.addEventListener('click',()=>{
    document.body.classList.remove('ai-collapsed');
    localStorage.setItem('mcassist_collapsed','0');
  });
}

if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded',createCollapseControls);
}else{
  createCollapseControls();
}
