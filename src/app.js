import {canvas,makeQR as encode,dimensions} from './engine.js';
import {searchBlend} from './search.js';
import {readBarcodes,prepareZXingModule} from 'zxing-wasm/reader';

const $=id=>document.getElementById(id);
const ctx=c=>c.getContext('2d',{willReadFrequently:true});
const frame=()=>new Promise(resolve=>requestAnimationFrame(()=>resolve()));
const state={qr:null,bytes:null,source:null,art:null,example:true,results:{},current:'fine',view:'blend',busy:false,report:null,revision:0};
const decoderReady=prepareZXingModule({overrides:{locateFile:()=>new URL('./vendor/zxing_reader.wasm',location.href).href},fireImmediately:true});
decoderReady.catch(()=>toast('识别引擎加载失败，请刷新页面重试。'));
let toastTimer;
function toast(text){$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5000);}
function sourceStatus(text,error=false){$('source-status').textContent=text;$('source-status').classList.toggle('error',error);}
function blob(c,type='image/png',quality){return new Promise((resolve,reject)=>c.toBlob(b=>b?resolve(b):reject(Error('图片导出失败')),type,quality));}
function equal(a,b){return a?.length===b?.length&&a.every((v,i)=>v===b[i]);}
async function read(input){await decoderReady;return (await readBarcodes(input,{formats:['QRCode'],tryHarder:true,tryRotate:true,tryInvert:true})).filter(r=>r.isValid);}
async function matches(c){return (await read(ctx(c).getImageData(0,0,c.width,c.height))).some(r=>equal(r.bytes,state.bytes));}
function imageFromURL(url){return new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(Error('图片读取失败，请使用 PNG、JPG 或 WebP'));i.src=url;});}
async function loadFile(file){
  if(file.size>20*1024*1024)throw Error('单张图片不能超过 20 MB');
  if(!/^image\/(png|jpeg|webp|bmp|x-ms-bmp)$/.test(file.type))throw Error('请使用 PNG、JPG、WebP 或 BMP 图片');
  const url=URL.createObjectURL(file);
  try{const image=await imageFromURL(url);if(image.naturalWidth*image.naturalHeight>40e6)throw Error('图片像素过大，请缩小到 4000 × 4000 左右再上传');return image;}finally{URL.revokeObjectURL(url);}
}
function imageCanvas(image,max=2048){const factor=Math.min(1,max/Math.max(image.width,image.height));const c=canvas(Math.round(image.width*factor),Math.round(image.height*factor));ctx(c).drawImage(image,0,0,c.width,c.height);return c;}
function invalidate(){state.revision++;state.results={};state.report=null;for(const id of ['download','share-card'])$(id).disabled=true;$('validation-status').textContent='○ 等待生成';$('validation-status').className='status-pill';$('save-hint').hidden=true;$('preview-frame').hidden=true;$('empty-state').hidden=false;$('progress-wrap').hidden=true;$('preview-size').textContent='长边 1600px';}
function makeQR(mask=0){return encode(state.bytes,mask);}
function resized(c,longEdge){const scale=longEdge/Math.max(c.width,c.height),out=canvas(Math.round(c.width*scale),Math.round(c.height*scale));ctx(out).drawImage(c,0,0,out.width,out.height);return out;}
function drawFit(g,image,x,y,w,h){const scale=Math.min(w/image.width,h/image.height),iw=image.width*scale,ih=image.height*scale;g.drawImage(image,x+(w-iw)/2,y+(h-ih)/2,iw,ih);}
function drawOriginal(){const c=$('before-canvas'),g=ctx(c);g.fillStyle='white';g.fillRect(0,0,c.width,c.height);if(state.source){const im=state.source;const s=Math.min(c.width/im.width,c.height/im.height);g.drawImage(im,(c.width-im.width*s)/2,(c.height-im.height*s)/2,im.width*s,im.height*s);}}
function paint(){const selected=state.results[state.current];if(!selected)return;const c=$('preview');c.width=selected.width;c.height=selected.height;drawOriginal();ctx(c).drawImage(selected.canvas,0,0);const ratio=c.width/c.height;$('preview-frame').style.aspectRatio=`${c.width} / ${c.height}`;$('preview-frame').style.width=`min(100%, ${Math.round(400*Math.min(1,ratio))}px)`;$('preview-size').textContent=`${c.width} × ${c.height}`;$('preview-frame').hidden=false;$('empty-state').hidden=true;}
function setBusy(busy){state.busy=busy;$('generate').disabled=busy||!state.bytes||!state.art;$('generate').innerHTML=busy?'正在融合与验证…':'生成我的个性码 <span>↗</span>';document.querySelectorAll('.controls input,.controls select').forEach(el=>el.disabled=busy);}
function progress(value,text){$('progress-wrap').hidden=false;$('progress').value=value;$('progress-text').textContent=text;}
async function check(c){await frame();const results=[];results.push({name:'原图',passed:await matches(c)});if(!results[0].passed)return results;
 for(const size of [384,512,768,1000]){const small=resized(c,size);results.push({name:`长边 ${size}px`,passed:await matches(small)});if(!results.at(-1).passed)return results;await frame();}
 const small=resized(c,768);
 const jpg=await blob(small,'image/jpeg',.8),bitmap=await createImageBitmap(jpg);const jpeg=canvas(small.width,small.height);ctx(jpeg).drawImage(bitmap,0,0);bitmap.close();results.push({name:'JPEG 压缩',passed:await matches(jpeg)});
 const g=ctx(small),d=g.getImageData(0,0,small.width,small.height);for(let i=0;i<d.data.length;i+=4){const y=Math.round(d.data[i]*.299+d.data[i+1]*.587+d.data[i+2]*.114);d.data[i]=d.data[i+1]=d.data[i+2]=y;}g.putImageData(d,0,0);results.push({name:'灰度',passed:await matches(small)});return results;
}
const allPass=checks=>checks.length===7&&checks.every(c=>c.passed);
async function generate(){
 if(state.busy)return;if(!state.bytes||!state.art){toast('请先上传二维码和背景图。');return;}
 invalidate();setBusy(true);progress(1,'准备图片与配色…');
 try{
  await decoderReady;dimensions(state.art);
  const fine=await searchBlend(state.bytes,state.art,{check,onProgress:(attempt,total)=>{progress(5+90*attempt/total,'正在保留底图并精简二维码边距…');},finalize:async candidate=>{
   await frame();const file=await blob(candidate.canvas),bitmap=await createImageBitmap(file),saved=canvas(candidate.width,candidate.height);ctx(saved).drawImage(bitmap,0,0);bitmap.close();const checks=await check(saved);return allPass(checks)?{canvas:saved,file,checks}:null;
  }});state.results={fine};
  if(!fine)throw Error('这组图片暂未通过识别测试，请换一张明暗更简洁或比例更接近方形的背景图后重试。');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',state.bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
  state.report={tool:'脑子有泡 艺术二维码实验室 / 脑子有泡 / APP',created_at:new Date().toISOString(),decoder:'ZXing-C++ WASM',payload_sha256:hash,payload_byte_length:state.bytes.length,phone_wechat_verified:false,opencv:'未在网页版运行',output_mode:'full-artwork-qr-layer',uniform_quiet_zone_guaranteed:false,aspect_ratio_preserved:true,variants:{fine:{exported:true,dot:fine.dot,profile:fine.profile,palette:fine.palette,mask:fine.mask,version:fine.version,width:fine.width,height:fine.height,functional_opacities:fine.opacities,qr_layer:fine.qrLayer,corner_change_score:fine.cornerScore,visual_score:fine.visualScore,compared_masks:fine.comparedMasks,checks:fine.checks}},limitations:['完整保留底图，仅二维码自身白边按像素最小化；识别验证针对完整融合图。','重编码保留内容字节，原矩阵与中央 Logo 可能变化。','软件识别不能代替手机、微信或印刷实扫。']};
  state.current='fine';showResult();progress(100,'完成：已从导出 PNG 重新读取并核对原内容。');toast('融合完成，已通过 7 项识别校验。');
 }catch(error){$('validation-status').textContent='! 尚未通过验证';$('validation-status').className='status-pill error';progress(0,error.message);toast(error.message);}
 finally{setBusy(false);}
}
function showResult(){const r=state.results[state.current];if(!r)return;$('validation-status').textContent='✓ 已生成，识别校验通过';$('validation-status').className='status-pill success';for(const id of ['download','share-card'])$(id).disabled=false;paint();}
async function save(file,name){const url=URL.createObjectURL(file),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);$('save-hint').hidden=false;}
async function shareCard(){
  await document.fonts.load('700 24px KNBobohei');
  const r=state.results[state.current];if(!r)return;
  const logo=await imageFromURL('./assets/pp-logo.png');
  const c=canvas(1600,1090),g=ctx(c);
  g.fillStyle='#faf5ff';g.fillRect(0,0,c.width,c.height);
  g.fillStyle='#594786';g.font='bold 44px KNBobohei';
  g.fillText('不止负责被扫 也负责表达你',80,95);
  g.drawImage(logo,76,112,44,44);
  g.font='24px KNBobohei';g.fillStyle='#8877aa';
  g.fillText('艺术二维码实验室 ｜ 脑子有泡出品 · APP 制作',130,145);
  g.fillStyle='#ffffff';g.fillRect(70,195,710,710);g.fillRect(820,195,710,710);
  g.drawImage($('before-canvas'),70,195,710,710);drawFit(g,r.canvas,820,195,710,710);
  g.font='24px KNBobohei';g.fillStyle='#c65c9e';
  g.fillText('原始二维码',70,955);g.fillText('码上不一样',820,955);
  g.font='20px KNBobohei';g.fillStyle='#8877aa';
  g.fillText('软件校验通过 · 手机微信请实扫确认',70,1025);
  g.fillText('你的需求、麻烦和脑洞，我都想听听',820,1025);
  g.save();g.translate(1403,1017);g.rotate(-.045);
  g.fillStyle='#decdeb';g.beginPath();g.roundRect(-126,-29,252,65,15);g.fill();
  g.fillStyle='#fce5f2';g.strokeStyle='#d5acd8';g.lineWidth=2;
  g.beginPath();g.roundRect(-130,-34,252,65,15);g.fill();g.stroke();
  g.fillStyle='#c8e8f5';g.fillRect(-85,-42,46,15);
  g.fillStyle='#a35998';g.font='bold 23px KNBobohei';g.textAlign='center';
  g.fillText('VX + Upao404',-4,7);g.restore();
  await save(await blob(c),'脑子有泡 艺术二维码实验室-前后对比.png');
  toast('对比图含二维码，请确认愿意分享后再发送。');
}
async function handleUpload(kind,file){if(!file||state.busy)return;setBusy(true);invalidate();
 try{const image=await loadFile(file);
  if(kind==='qr'){
   sourceStatus('正在识别二维码…');const source=imageCanvas(image);let symbols=await read(ctx(source).getImageData(0,0,source.width,source.height));
   if(!symbols.length)throw Error('没有识别到二维码，请上传清晰完整的原图。');
   state.source=source;state.symbols=symbols;state.bytes=symbols[0].bytes;state.qr=makeQR();
   $('symbol-choice').hidden=symbols.length===1;$('symbols').replaceChildren(...symbols.map((s,i)=>{const op=document.createElement('option');op.value=i;op.textContent=`二维码 ${i+1}（位置 ${Math.round(s.position.topLeft.x)}, ${Math.round(s.position.topLeft.y)}）`;return op;}));
   if(symbols.length>1){const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='请选择要使用的二维码';placeholder.selected=true;placeholder.disabled=true;$('symbols').prepend(placeholder);state.bytes=null;state.qr=null;drawOriginal();ctx($('preview')).drawImage($('before-canvas'),0,0);}
   sourceStatus(symbols.length===1?'✓ 已识别二维码，原内容仅保存在当前页面。':'检测到多个二维码，请按位置选择后再融合。');
  }else{const art=imageCanvas(image);dimensions(art);state.art=art;sourceStatus(state.bytes?'✓ 两张图片已就绪，可以开始融合。':'背景图已载入，请继续上传二维码。');}
  state.example=false;$(kind+'-label').textContent=file.name;
  $(kind+'-thumb').src=imageCanvas(image,180).toDataURL('image/png');$(kind+'-thumb').hidden=false;paint();
 }catch(error){
  if(kind==='qr'){state.bytes=null;state.qr=null;state.source=null;$('symbol-choice').hidden=true;sourceStatus(error.message,true);$('qr-label').textContent='请重新上传';$('qr-thumb').hidden=true;}
  else{state.art=null;sourceStatus(error.message,true);$('art-label').textContent='请重新上传';$('art-thumb').hidden=true;}
  toast(error.message);
 }finally{$(kind+'-file').value='';setBusy(false);}
}
for(const kind of ['qr','art']){
 $(kind+'-file').addEventListener('change',event=>handleUpload(kind,event.target.files[0]));const drop=$(kind+'-drop');drop.addEventListener('dragover',event=>{event.preventDefault();drop.classList.add('dragging');});drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));drop.addEventListener('drop',event=>{event.preventDefault();drop.classList.remove('dragging');handleUpload(kind,event.dataTransfer.files[0]);});
}
$('symbols').addEventListener('change',()=>{state.bytes=state.symbols[+$('symbols').value].bytes;state.qr=makeQR();invalidate();setBusy(false);});
$('generate').addEventListener('click',generate);
$('download').addEventListener('click',()=>{const r=state.results[state.current];if(r)save(r.file,'脑子有泡 艺术二维码实验室-融合二维码.png');});
$('share-card').addEventListener('click',()=>shareCard().catch(e=>toast(e.message)));
$('help-open').addEventListener('click',()=>$('help').showModal());for(const id of ['help-close','help-done'])$(id).addEventListener('click',()=>$('help').close());
setBusy(false);
