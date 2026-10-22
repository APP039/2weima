import {canvas} from './engine.js';
const allPass=checks=>checks.length===7&&checks.every(c=>c.passed);

// The poster is the bottom layer and is never cropped or repositioned.
// Only the QR layer is trimmed to its actual matrix, plus a tested small rim.
export function composeFullArtwork(candidate,prepared,marginPixels=0){
  const {width,height,x,y,side,buffer}=prepared.layout;
  if(!Number.isInteger(marginPixels)||marginPixels<0||marginPixels>buffer)throw Error('无效的二维码边距');
  const out=canvas(width,height),g=out.getContext('2d',{willReadFrequently:true});
  g.drawImage(prepared.base,0,0);
  if(marginPixels){g.fillStyle='#fff';g.fillRect(x-marginPixels,y-marginPixels,side+marginPixels*2,side+marginPixels*2);}
  g.drawImage(candidate.canvas,x,y,side,side,x,y,side,side);
  return {...candidate,canvas:out,width,height,layout:prepared.layout,qrLayer:{mode:'trimmed-overlay',marginPixels,rect:{x,y,width:side,height:side},minimumVerified:marginPixels===0,fullArtworkPreserved:true}};
}

export async function findMinimumLayerMargin(candidate,prepared,check,maxMargin,onTrial=()=>{}){
  for(let margin=0;margin<=maxMargin;margin++){
    onTrial(margin,maxMargin);
    const combined=composeFullArtwork(candidate,prepared,margin),checks=await check(combined.canvas);
    if(allPass(checks))return {...combined,checks,qrLayer:{...combined.qrLayer,minimumVerified:true,marginTrials:margin+1}};
  }
  return null;
}
