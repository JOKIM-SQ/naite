/**
 * Browser port of PixelOE legacy outline/color processing (Apache-2.0),
 * reference 7ce444b36d3876a151d845d4493240e904454d89.
 * Patch 8, thickness 1, color matching, no upscale; final float Lab 64 colors.
 * Pillow's tile quantizer is replaced by deterministic RGB two-means, so output
 * is an approximation of the selected reference, not byte-identical Python.
 */
/** @typedef {typeof import('@techstark/opencv-js')} CV */
/** @typedef {import('@techstark/opencv-js').Mat} Mat */
const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const clamp = (v) => Math.max(0, Math.min(255, v));

/** @param {CV} cv @param {Uint8ClampedArray} pixels @param {number} width @param {number} height @param {{width:number,height:number}} grid */
export function detailGrid(cv, pixels, width, height, grid) {
  const gw = grid?.width, gh = grid?.height;
  if (![width,height,gw,gh].every(v=>Number.isSafeInteger(v)&&v>0) || width>16384 || height>16384 || width*height>40_000_000 || !(pixels instanceof Uint8ClampedArray) || pixels.length!==width*height*4)
    throw new Error('이미지 크기 또는 픽셀 데이터가 올바르지 않습니다.');
  if (gw*gh*64>4_000_000) throw new Error('세밀한 풍경 처리 크기가 너무 큽니다. 격자 크기를 줄여 주세요.');
  /** @type {Mat[]} */ const owned=[];
  /** @param {Mat} mat */ const own=(mat)=>{owned.push(mat);return mat;};
  const fresh=()=>own(new cv.Mat());
  try {
    const w=gw*8,h=gh*8,n=w*h;
    // Resize premultiplied RGBA, then recover straight RGB. Hidden RGB never
    // influences visible edges; transparent holes get nearest visible color.
    const input=own(cv.matFromArray(height,width,cv.CV_8UC4,pixels));
    for(let i=0;i<input.data.length;i+=4){const a=input.data[i+3]/255;for(let c=0;c<3;c++)input.data[i+c]=Math.round(input.data[i+c]*a);}
    const rgba=fresh();cv.resize(input,rgba,new cv.Size(w,h),0,0,cv.INTER_LINEAR);
    const original=own(new cv.Mat(h,w,cv.CV_8UC3));
    const queue=new Int32Array(n),seen=new Uint8Array(n);let tail=0;
    for(let i=0;i<n;i++){const a=rgba.data[i*4+3];if(a){seen[i]=1;queue[tail++]=i;}for(let c=0;c<3;c++)original.data[i*3+c]=a?clamp(Math.round(rgba.data[i*4+c]*255/a)):0;}
    for(let head=0;head<tail;head++){const i=queue[head],x=i%w;for(const j of [x?i-1:-1,x<w-1?i+1:-1,i-w,i+w])if(j>=0&&j<n&&!seen[j]){seen[j]=1;queue[tail++]=j;original.data.set(original.data.subarray(i*3,i*3+3),j*3);}}
    const alphaSmall=fresh();cv.resize(rgba,alphaSmall,new cv.Size(gw,gh),0,0,cv.INTER_AREA);
    const lab=fresh();cv.cvtColor(original,lab,cv.COLOR_RGB2Lab);
    const coarse=own(new cv.Mat(h/4,w/4,cv.CV_32FC1));
    const histogram=new Uint16Array(256);
    for(let y=0;y<h;y+=4)for(let x=0;x<w;x+=4){
      histogram.fill(0);let lo=255,hi=0;
      for(let dy=-6;dy<10;dy++)for(let dx=-6;dx<10;dx++){
        const yy=Math.max(0,Math.min(h-1,y+dy)),xx=Math.max(0,Math.min(w-1,x+dx));
        const l=lab.data[(yy*w+xx)*3];histogram[l]++;
        if(dy>=-2&&dy<6&&dx>=-2&&dx<6){lo=Math.min(lo,l);hi=Math.max(hi,l);}
      }
      let count=0,median=0;for(;median<255;median++){count+=histogram[median];if(count>=128)break;}
      coarse.data32F[(y/4)*(w/4)+x/4]=sigmoid((median/255-.5)*9-(hi-2*median+lo)/255*4);
    }
    const weight=fresh();cv.resize(coarse,weight,new cv.Size(w,h),0,0,cv.INTER_LINEAR);
    let min=1,max=0;for(const v of weight.data32F){min=Math.min(min,v);max=Math.max(max,v);}
    const square=own(cv.Mat.ones(3,3,cv.CV_8U));
    const cross=own(cv.matFromArray(3,3,cv.CV_8U,[0,1,0,1,1,1,0,1,0]));
    const dark=fresh(),light=fresh();cv.erode(original,dark,square);cv.dilate(original,light,square);
    const expanded=own(new cv.Mat(h,w,cv.CV_8UC3));
    for(let i=0;i<n;i++){const t=max?(weight.data32F[i]-min)/max:0,o=sigmoid((t-.5)*5)*.25;for(let c=0;c<3;c++){const j=i*3+c;expanded.data[j]=(dark.data[j]*t+light.data[j]*(1-t))*(1-o)+original.data[j]*o;}}
    cv.erode(expanded,dark,cross);cv.dilate(dark,light,cross,new cv.Point(-1,-1),2);cv.erode(light,expanded,cross);
    const sourceLab=fresh();cv.cvtColor(expanded,sourceLab,cv.COLOR_RGB2Lab);
    const stats=(data)=>{let sum=0,sq=0;for(const v of data){sum+=v;sq+=v*v;}const mean=sum/data.length;return [mean,Math.sqrt(Math.max(0,sq/data.length-mean*mean))];};
    const [sm,ss]=stats(sourceLab.data),[tm,ts]=stats(lab.data);
    for(let i=0;i<sourceLab.data.length;i++)sourceLab.data[i]=clamp(ss?(sourceLab.data[i]-sm)/ss*ts+tm:tm);
    cv.cvtColor(sourceLab,expanded,cv.COLOR_Lab2RGB);
    const sourceFloat=fresh(),targetFloat=fresh();expanded.convertTo(sourceFloat,cv.CV_32F);original.convertTo(targetFloat,cv.CV_32F);
    const sourceLow=fresh(),targetLow=fresh();sourceFloat.copyTo(sourceLow);targetFloat.copyTo(targetLow);
    for(const radius of [2,4,8,16,32]){const size=new cv.Size(radius*2+1,radius*2+1);cv.GaussianBlur(sourceLow,sourceLow,size,0,0,cv.BORDER_DEFAULT);cv.GaussianBlur(targetLow,targetLow,size,0,0,cv.BORDER_DEFAULT);}
    for(let i=0;i<expanded.data.length;i++)expanded.data[i]=clamp(sourceFloat.data32F[i]-sourceLow.data32F[i]+targetLow.data32F[i]);
    const small=own(new cv.Mat(gh,gw,cv.CV_8UC3));
    // Two dominant RGB means per 8×8 tile. Deterministic extrema initialization;
    // ties choose the darker cluster, keeping thin architectural boundaries.
    for(let y=0;y<gh;y++)for(let x=0;x<gw;x++){
      let low=Infinity,high=-Infinity;const centers=new Float64Array(6),sums=new Float64Array(6),counts=new Uint16Array(2);
      for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++){const j=((y*8+dy)*w+x*8+dx)*3,v=expanded.data[j]+expanded.data[j+1]+expanded.data[j+2];if(v<low){low=v;centers.set(expanded.data.subarray(j,j+3),0);}if(v>high){high=v;centers.set(expanded.data.subarray(j,j+3),3);}}
      for(let iter=0;iter<8;iter++){sums.fill(0);counts.fill(0);for(let dy=0;dy<8;dy++)for(let dx=0;dx<8;dx++){const j=((y*8+dy)*w+x*8+dx)*3;let a=0,b=0;for(let c=0;c<3;c++){a+=(expanded.data[j+c]-centers[c])**2;b+=(expanded.data[j+c]-centers[c+3])**2;}const k=a<=b?0:1;counts[k]++;for(let c=0;c<3;c++)sums[k*3+c]+=expanded.data[j+c];}let movement=0;for(let k=0;k<2;k++)if(counts[k])for(let c=0;c<3;c++){const v=sums[k*3+c]/counts[k];movement+=Math.abs(v-centers[k*3+c]);centers[k*3+c]=v;}if(movement<.1)break;}
      const k=counts[0]>=counts[1]?0:1;for(let c=0;c<3;c++)small.data[(y*gw+x)*3+c]=Math.round(centers[k*3+c]);
    }
    const visible=[];for(let i=0;i<gw*gh;i++)if(alphaSmall.data[i*4+3])visible.push(i);
    const output=new Uint8ClampedArray(gw*gh*4);
    if(!visible.length)return {data:output,width:gw,height:gh};
    const unique=new Set();for(const i of visible)unique.add(small.data[i*3]*65536+small.data[i*3+1]*256+small.data[i*3+2]);
    const floats=fresh(),smallLab=fresh();small.convertTo(floats,cv.CV_32F,1/255);cv.cvtColor(floats,smallLab,cv.COLOR_RGB2Lab);
    const samples=own(new cv.Mat(visible.length,3,cv.CV_32F));for(let i=0;i<visible.length;i++)samples.data32F.set(smallLab.data32F.subarray(visible[i]*3,visible[i]*3+3),i*3);
    const labels=fresh(),centers=fresh();cv.setRNGSeed(0);
    cv.kmeans(samples,Math.min(64,unique.size),labels,new cv.TermCriteria(cv.TermCriteria_EPS|cv.TermCriteria_MAX_ITER,50,.1),4,2 /* OpenCV KMEANS_PP_CENTERS */,centers);
    const paletteLab=own(new cv.Mat(1,centers.rows,cv.CV_32FC3)),palette=fresh();paletteLab.data32F.set(centers.data32F);cv.cvtColor(paletteLab,palette,cv.COLOR_Lab2RGB);
    for(let p=0;p<visible.length;p++){const i=visible[p],k=labels.data32S[p];for(let c=0;c<3;c++)output[i*4+c]=Math.round(clamp(palette.data32F[k*3+c]*255));output[i*4+3]=alphaSmall.data[i*4+3];}
    return {data:output,width:gw,height:gh};
  } finally {for(let i=owned.length-1;i>=0;i--)owned[i].delete();}
}
