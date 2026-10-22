import QRCode from 'qrcode';
import AlignmentPattern from 'qrcode/lib/core/alignment-pattern.js';

export const canvas=(w,h=w)=>Object.assign(document.createElement('canvas'),{width:w,height:h});
const ctx=c=>c.getContext('2d',{willReadFrequently:true});
const clamp=(v,a=0,b=255)=>Math.min(b,Math.max(a,v));
const luminance=rgb=>rgb[0]*.299+rgb[1]*.587+rgb[2]*.114;
export const makeQR=(bytes,mask=0)=>QRCode.create([{data:bytes,mode:'byte'}],{errorCorrectionLevel:'H',maskPattern:mask});
export function functional(qr,r,c){return qr.modules.isReserved(r,c);}
export function dimensions(art,longEdge=1600){
  const ratio=art.width/art.height;
  if(!Number.isFinite(ratio)||ratio<=0)throw Error('背景图尺寸无效，请重新上传。');
  if(Math.max(ratio,1/ratio)>3)throw Error('这张背景图过于狭长，请先裁剪到长宽比 3:1 以内，以便保留足够大的二维码。');
  return ratio>=1?{width:longEdge,height:Math.round(longEdge/ratio)}:{width:Math.round(longEdge*ratio),height:longEdge};
}
function sample(g,x,y,w,h){
  const data=g.getImageData(Math.floor(x),Math.floor(y),Math.max(1,Math.floor(w)),Math.max(1,Math.floor(h))).data;
  const sum=[0,0,0];let count=0;
  const stride=Math.max(4,Math.floor(data.length/1024/4)*4);
  for(let i=0;i<data.length;i+=stride){for(let k=0;k<3;k++)sum[k]+=data[i+k];count++;}
  return sum.map(v=>v/count);
}
function regionKey(qr,alignment,r,c){
  const n=qr.modules.size;
  if(r<9&&c<9)return 'top-left';
  if(r<9&&c>=n-8)return 'top-right';
  if(r>=n-8&&c<9)return 'bottom-left';
  for(const [ar,ac] of alignment)if(Math.abs(r-ar)<=2&&Math.abs(c-ac)<=2)return `alignment-${ar}-${ac}`;
  if(r===6)return 'horizontal';
  if(c===6)return 'vertical';
  return 'format-version';
}
export function prepareArtwork(art,qr){
  const {width,height}=dimensions(art),n=qr.modules.size;
  const cell=Math.floor(Math.min(width,height)/(n+8));
  if(cell<3)throw Error('二维码内容较长，请换用长宽比更接近方形的背景图。');
  const side=n*cell,x=Math.floor((width-side)/2),y=Math.floor((height-side)/2),buffer=cell*4;
  const base=canvas(width,height),g=ctx(base);g.fillStyle='#fff';g.fillRect(0,0,width,height);g.drawImage(art,0,0,width,height);
  const global=sample(g,0,0,width,height),gy=luminance(global),tint=global.map(v=>(v-gy)*.10);
  const edge=global.map(v=>Math.round(clamp(249+(v-gy)*.04,245,253)));
  const alignment=AlignmentPattern.getPositions(qr.version),groups=new Map(),keys=new Array(n*n);
  for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(functional(qr,r,c)){
    const key=regionKey(qr,alignment,r,c);keys[r*n+c]=key;
    const group=groups.get(key)||{r0:r,r1:r,c0:c,c1:c};
    group.r0=Math.min(group.r0,r);group.r1=Math.max(group.r1,r);group.c0=Math.min(group.c0,c);group.c1=Math.max(group.c1,c);groups.set(key,group);
  }
  for(const group of groups.values()){
    const rgb=sample(g,x+group.c0*cell,y+group.r0*cell,(group.c1-group.c0+1)*cell,(group.r1-group.r0+1)*cell),mean=luminance(rgb);
    group.mean=mean;
    group.dark=rgb.map(v=>clamp(26+(v-mean)*.16,8,55));
    group.light=rgb.map(v=>clamp(250+(v-mean)*.025,246,254));
  }
  return {base,groups,keys,tint,edge,layout:{width,height,n,cell,x,y,side,buffer},palette:{mode:Math.max(...global)-Math.min(...global)<5?'neutral':'image'}};
}

function softenBuffer(g,prepared,border){
  if(!Object.values(border).some(v=>v>0))return 0;
  const {layout,edge}=prepared,{width,height,cell,x,y,side,buffer}=layout;
  const image=g.getImageData(0,0,width,height),data=image.data,fade=cell*1.2;
  let changed=0;
  // Correction is optional and independently controlled on each side. The
  // transition fades at both ends so it cannot paint a hard square outline.
  for(let py=0;py<height;py++)for(let px=0;px<width;px++){
    if(px>=x&&px<x+side&&py>=y&&py<y+side)continue;
    const left=x-px,right=px-(x+side-1),top=y-py,bottom=py-(y+side-1);
    const distance=Math.max(left,right,top,bottom);
    if(distance>buffer+fade)continue;
    const strength=Math.max(left>0?border.left||0:0,right>0?border.right||0:0,top>0?border.top||0:0,bottom>0?border.bottom||0:0);
    const alpha=strength*Math.min(1,distance/(cell*.6))*clamp((buffer+fade-distance)/fade,0,1);
    if(!alpha)continue;
    const i=(py*width+px)*4;
    for(let k=0;k<3;k++){const v=Math.round(data[i+k]*(1-alpha)+edge[k]*alpha);changed+=Math.abs(v-data[i+k]);data[i+k]=v;}
  }
  g.putImageData(image,0,0);return changed/(width*height*3);
}
export function renderCandidate(qr,prepared,{dot=.24,opacity=.2,opacities={},border={left:0,right:0,top:0,bottom:0}}={}){
  const {base,groups,keys,tint,layout}=prepared,{width,height,n,cell,x,y}=layout;
  const out=canvas(width,height),g=ctx(out);g.drawImage(base,0,0);
  const borderChange=softenBuffer(g,prepared,border);
  const pixels=g.getImageData(x,y,n*cell,n*cell),data=pixels.data;
  const patch=Math.max(2,Math.round(cell*dot)),offset=Math.floor((cell-patch)/2);
  const used=Object.fromEntries([...groups.keys()].map(key=>[key,clamp(opacities[key]??opacity,0,1)]));
  let difference=0,functionDifference=0,functionPixels=0,cornerDifference=0,cornerPixels=0;
  for(let r=0;r<n;r++)for(let c=0;c<n;c++){
    const dark=qr.modules.get(r,c),key=keys[r*n+c],group=key?groups.get(key):null;
    const start=group?0:offset,end=group?cell:offset+patch;
    for(let dy=start;dy<end;dy++)for(let dx=start;dx<end;dx++){
      const i=((r*cell+dy)*n*cell+c*cell+dx)*4;
      const isCorner=group&&(key==='top-left'||key==='top-right'||key==='bottom-left'||key.startsWith('alignment-'));
      if(group)functionPixels++;if(isCorner)cornerPixels++;
      const alpha=group?used[key]:1;
      const next=[0,1,2].map(k=>{
        const target=group?(dark?group.dark[k]:group.light[k]):clamp((dark?24:250)+tint[k]);
        return data[i+k]+alpha*(target-data[i+k]);
      });
      if(group){
        // Recover only the local contrast lost to crossing artwork strokes.
        // The bounds follow the region's background, so dark artwork does not
        // acquire a white plate. Most pixels retain the plain alpha blend.
        const targetMean=luminance(dark?group.dark:group.light);
        const bound=group.mean*(1-alpha)+targetMean*alpha,lum=luminance(next);
        if(dark&&lum>bound){const factor=bound/Math.max(1,lum);for(let k=0;k<3;k++)next[k]*=factor;}
        if(!dark&&lum<bound){const amount=(bound-lum)/Math.max(1,255-lum);for(let k=0;k<3;k++)next[k]+=(255-next[k])*amount;}
      }
      for(let k=0;k<3;k++){
        const original=data[i+k];
        const v=Math.round(next[k]);
        const change=Math.abs(v-original);difference+=change;if(group)functionDifference+=change;if(isCorner)cornerDifference+=change;data[i+k]=v;
      }
    }
  }
  g.putImageData(pixels,x,y);
  const cornerScore=cornerDifference/Math.max(1,cornerPixels*3);
  const visualScore=cornerScore*2+functionDifference/Math.max(1,functionPixels*3)*.2+difference/(n*cell*n*cell*3)*.05+dot*3+borderChange*4;
  return {canvas:out,visualScore,cornerScore,dot:patch/cell,requestedDot:dot,profile:'alpha-blend-local-contrast',opacity,opacities:used,border:{...border},mask:qr.maskPattern,version:qr.version,width,height,layout,palette:prepared.palette};
}
