// Shared signature pad for touch, pen and mouse. Nothing is required: an empty pad simply returns no signature.
export function signaturePad(canvas){
  canvas.width=900;canvas.height=300;const ctx=canvas.getContext('2d');let drawing=false,drawn=false;
  const clear=()=>{ctx.fillStyle='#fff';ctx.fillRect(0,0,900,300);ctx.strokeStyle='#263a4d';ctx.lineWidth=3;ctx.lineCap='round';ctx.lineJoin='round';drawn=false;};
  const point=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*900/r.width,(e.clientY-r.top)*300/r.height];};
  canvas.addEventListener('pointerdown',e=>{drawing=true;canvas.setPointerCapture?.(e.pointerId);ctx.beginPath();ctx.moveTo(...point(e));});
  canvas.addEventListener('pointermove',e=>{if(!drawing)return;ctx.lineTo(...point(e));ctx.stroke();drawn=true;});
  for(const type of ['pointerup','pointercancel'])canvas.addEventListener(type,()=>drawing=false);clear();
  return {
    clear,get drawn(){return drawn;},
    dataURL(){return drawn?canvas.toDataURL('image/png'):null;},
    async file(name){if(!drawn)return null;const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));return new File([blob],name+'.png',{type:'image/png'});}
  };
}
export function signatureBox(id,title){return `<div class="signaturebox"><h3>${title}</h3><canvas id="${id}" class="signature" aria-label="${title}"></canvas><button type="button" data-clear-signature="${id}">Löschen</button></div>`;}
// Connects every signature canvas inside root and returns the pads by canvas id.
export function mountSignatures(root){const pads={};for(const canvas of root.querySelectorAll('canvas.signature'))pads[canvas.id]=signaturePad(canvas);root.addEventListener('click',e=>{const button=e.target.closest('[data-clear-signature]');if(button)pads[button.dataset.clearSignature]?.clear();});return pads;}
