import {makeQR,prepareArtwork,renderCandidate} from './engine.js';
import {composeFullArtwork,findMinimumLayerMargin} from './layer.js';
const allPass=checks=>checks.length===7&&checks.every(c=>c.passed);
const emptyBorder=()=>({left:0,right:0,top:0,bottom:0});

export async function searchBlend(bytes,art,{check,finalize,onProgress=()=>{}}){
  const masks=[0,2,4,6],matrices=masks.map(mask=>makeQR(bytes,mask)),prepared=prepareArtwork(art,matrices[0]);
  const maxMargin=prepared.layout.buffer;
  const seedLimit=80,refineLimit=224,totalLimit=seedLimit+maxMargin*4+refineLimit+maxMargin*4;
  let attempts=0,refinementAttempts=0,activeMargin=0,seedAttempts=0;
  const failures=new Set();
  const raw=(matrix,options)=>renderCandidate(matrix,prepared,{...options,border:emptyBorder()});
  async function evaluate(matrix,options,refining=false){
    const key=JSON.stringify([matrix.maskPattern,options.dot,[...prepared.groups.keys()].map(k=>options.opacities?.[k]??options.opacity),activeMargin]);
    if(failures.has(key))return null;
    if(refining&&refinementAttempts>=refineLimit)return null;
    onProgress(++attempts,totalLimit);if(refining)refinementAttempts++;else seedAttempts++;
    const candidate=composeFullArtwork(raw(matrix,options),prepared,activeMargin),checks=await check(candidate.canvas);
    if(allPass(checks))return {...candidate,checks};
    failures.add(key);return null;
  }
  async function refine(initial){
    let best=initial;
    const matrix=matrices.find(q=>q.maskPattern===best.mask);
    async function reduceDots(){
      for(const dot of [.24,.34,.44,.55,.64]){
        if(dot>=best.requestedDot||refinementAttempts>=refineLimit)break;
        const c=await evaluate(matrix,{dot,opacity:best.opacity,opacities:best.opacities},true);
        if(c&&c.visualScore<=best.visualScore){best=c;break;}
      }
    }
    await reduceDots();
    const alignment=[...prepared.groups.keys()].filter(k=>k.startsWith('alignment-')).reverse();
    const regions=['horizontal','vertical','format-version',...alignment,'top-left','top-right','bottom-left'].filter(k=>prepared.groups.has(k)).slice(0,10);
    for(let pass=0;pass<2;pass++)for(const key of regions){
      for(const alpha of [.10,.15,.20,.25,.30,.35,.40,.50,.65,.80]){
        if(alpha>=best.opacities[key]||refinementAttempts>=refineLimit)break;
        const c=await evaluate(matrix,{dot:best.requestedDot,opacity:best.opacity,opacities:{...best.opacities,[key]:alpha}},true);
        if(c&&c.visualScore<=best.visualScore)best=c;
      }
    }
    await reduceDots();
    return best;
  }
  async function finish(valid){
    const refined=[];
    valid.sort((a,b)=>a.visualScore-b.visualScore);
    for(const c of valid){
      let best=await refine(c);
      if(activeMargin>0){
        const matrix=matrices.find(q=>q.maskPattern===best.mask);
        const minimized=await findMinimumLayerMargin(raw(matrix,{dot:best.requestedDot,opacity:best.opacity,opacities:best.opacities}),prepared,check,activeMargin,()=>onProgress(++attempts,totalLimit));
        if(minimized)best=minimized;
      }
      refined.push(best);
    }
    refined.sort((a,b)=>a.qrLayer.marginPixels-b.qrLayer.marginPixels||a.visualScore-b.visualScore);
    for(const c of [...refined,...valid]){
      const saved=await finalize(c);
      if(saved)return {...c,...saved,attempts,refinementAttempts,comparedMasks:4,qrLayer:{...c.qrLayer,minimumVerified:c.qrLayer.minimumVerified||activeMargin===0}};
    }
    return null;
  }
  // Test the FINAL full poster with a zero-rim QR overlay. Prefer
  // a stronger readable matrix to adding an unnecessary external border.
  for(const opacity of [.20,.25,.30,.35,.40,.50,.65,.80,1])for(const dot of [.24,.34,...(opacity===1?[.55,.80]:[])]){
    if(seedAttempts>=seedLimit)break;
    const valid=[];
    for(const matrix of matrices){const c=await evaluate(matrix,{dot,opacity});if(c)valid.push(c);}
    if(valid.length){const result=await finish(valid);if(result)return result;}
  }
  // Only when zero-margin candidates all fail do we permit any rim. Start at
  // one OUTPUT pixel and test each integer, so there is no fixed visual frame.
  for(activeMargin=1;activeMargin<=maxMargin;activeMargin++){
    const valid=[];
    for(const matrix of matrices){const c=await evaluate(matrix,{dot:.80,opacity:1});if(c){c.qrLayer.minimumVerified=true;valid.push(c);}}
    if(valid.length){const result=await finish(valid);if(result)return result;}
  }
  return null;
}
