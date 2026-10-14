(function(root){
  const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
  function imagePoint(x,y,view){return {x:Math.floor((x-view.x)/view.zoom),y:Math.floor((y-view.y)/view.zoom)};}
  function zoomAt(view,next,x,y){next=clamp(next,1,64);const ratio=next/view.zoom;return {zoom:next,x:x-(x-view.x)*ratio,y:y-(y-view.y)*ratio};}
  function floodPixels(data,width,height,x,y,color){
    if(x<0||y<0||x>=width||y>=height)return false;
    const start=(y*width+x)*4,target=[...data.slice(start,start+4)];if(target.every((v,i)=>v===color[i]))return false;
    const pending=[y*width+x],visited=new Uint8Array(width*height);
    while(pending.length){const n=pending.pop();if(visited[n])continue;visited[n]=1;const i=n*4;if(!target.every((v,k)=>data[i+k]===v))continue;data.set(color,i);const px=n%width,py=Math.floor(n/width);if(px)pending.push(n-1);if(px<width-1)pending.push(n+1);if(py)pending.push(n-width);if(py<height-1)pending.push(n+width);}
    return true;
  }
  function create(canvas,viewport,{onChange=()=>{},onStatus=()=>{},onColor=()=>{}}={}){
    const ctx=canvas.getContext('2d',{willReadFrequently:true}),stage=canvas.parentElement;
    let view={zoom:8,x:0,y:0},tool='paint',color='#71d69c',size=1,opacity=1,mirror=false,grid=true,space=false,gesture=null,disposed=false,frame=null;
    const undo=[],redo=[],events=[];
    const listen=(target,name,fn,options)=>{target.addEventListener(name,fn,options);events.push(()=>target.removeEventListener(name,fn,options));};
    const snapshot=()=>ctx.getImageData(0,0,canvas.width,canvas.height);
    const status=point=>onStatus({...view,tool,size,opacity,mirror,grid,undo:undo.length,redo:redo.length,point});
    function position(){stage.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.zoom})`;stage.style.setProperty('--pixel-line',`${1/view.zoom}px`);stage.classList.toggle('show-grid',grid&&view.zoom>=4);viewport.classList.toggle('hand-tool',tool==='hand'||space);status();}
    function changed(){if(frame!==null)return;frame=requestAnimationFrame(()=>{frame=null;if(!disposed)onChange(canvas.toDataURL('image/png'));});}
    function commit(before){if(!before)return;const after=snapshot();if(before.data.every((v,i)=>v===after.data[i]))return;undo.push(before);if(undo.length>100)undo.shift();redo.length=0;changed();status();}
    function local(event){const rect=viewport.getBoundingClientRect();return {x:event.clientX-rect.left-viewport.clientLeft,y:event.clientY-rect.top-viewport.clientTop};}
    const inside=p=>p.x>=0&&p.y>=0&&p.x<canvas.width&&p.y<canvas.height;
    function mark(x,y,erase=false){const offset=Math.floor(size/2);ctx.globalAlpha=opacity;if(erase)ctx.clearRect(x-offset,y-offset,size,size);else{ctx.fillStyle=color;ctx.fillRect(x-offset,y-offset,size,size);}if(mirror){if(erase)ctx.clearRect(canvas.width-x+offset-size,y-offset,size,size);else ctx.fillRect(canvas.width-x+offset-size,y-offset,size,size);}ctx.globalAlpha=1;}
    function line(a,b,erase=false){const steps=Math.max(Math.abs(a.x-b.x),Math.abs(a.y-b.y),1);for(let i=0;i<=steps;i++)mark(Math.round(a.x+(b.x-a.x)*i/steps),Math.round(a.y+(b.y-a.y)*i/steps),erase);}
    function pick(p){if(!inside(p))return;const rgba=ctx.getImageData(p.x,p.y,1,1).data;color='#'+[...rgba].slice(0,3).map(v=>v.toString(16).padStart(2,'0')).join('');opacity=rgba[3]/255;onColor(color,opacity);status(p);}
    function paint(p){if(!inside(p)){gesture.last=null;return;}const mode=gesture.tool;if(mode==='line'||mode==='rect'){ctx.putImageData(gesture.before,0,0);if(mode==='line')line(gesture.start,p);else{const a=gesture.start;line(a,{x:p.x,y:a.y});line({x:p.x,y:a.y},p);line(p,{x:a.x,y:p.y});line({x:a.x,y:p.y},a);}}else{line(gesture.last||p,p,mode==='erase');gesture.last=p;}changed();status(p);}
    function finish(cancel=false){if(!gesture)return;const old=gesture;gesture=null;viewport.classList.remove('panning');if(old.before){if(cancel){ctx.putImageData(old.before,0,0);changed();}else commit(old.before);}status();}
    listen(viewport,'pointerdown',event=>{
      if(event.button!==0&&event.button!==1&&event.button!==2)return;event.preventDefault();viewport.focus({preventScroll:true});const pos=local(event),p=imagePoint(pos.x,pos.y,view);
      if(event.button===2||(event.button===0&&!space&&tool==='pick')){pick(p);return;}
      if(event.button===1||space||tool==='hand'){gesture={pan:true,start:pos,view:{...view},pointer:event.pointerId};viewport.classList.add('panning');viewport.setPointerCapture(event.pointerId);return;}
      if(!inside(p))return;const before=snapshot();
      if(tool==='fill'){const image=snapshot(),rgb=[1,3,5].map(index=>parseInt(color.slice(index,index+2),16)),rgba=[...rgb,Math.round(opacity*255)];floodPixels(image.data,canvas.width,canvas.height,p.x,p.y,rgba);if(mirror)floodPixels(image.data,canvas.width,canvas.height,canvas.width-1-p.x,p.y,rgba);ctx.putImageData(image,0,0);commit(before);return;}
      gesture={tool,before,start:p,last:null,pointer:event.pointerId};viewport.setPointerCapture(event.pointerId);paint(p);
    });
    listen(viewport,'pointermove',event=>{const pos=local(event),p=imagePoint(pos.x,pos.y,view);if(!gesture){status(inside(p)?p:null);return;}if(gesture.pan){view={...view,x:gesture.view.x+pos.x-gesture.start.x,y:gesture.view.y+pos.y-gesture.start.y};position();}else paint(p);});
    listen(viewport,'pointerup',event=>{if(gesture?.pointer!==event.pointerId)return;finish();if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);});
    listen(viewport,'pointercancel',()=>finish(true));listen(viewport,'lostpointercapture',()=>finish());listen(viewport,'contextmenu',event=>event.preventDefault());listen(viewport,'auxclick',event=>{if(event.button===1)event.preventDefault();});
    listen(viewport,'wheel',event=>{event.preventDefault();if(gesture)return;const pos=local(event);view=zoomAt(view,view.zoom*Math.exp(-event.deltaY*(event.deltaMode===1?.04:.002)),pos.x,pos.y);position();},{passive:false});
    listen(window,'blur',()=>{space=false;finish();position();});
    const api={
      setTool(value){finish();tool=value;position();},setColor(value){color=value;},setSize(value){size=clamp(Math.round(value),1,16);status();},setOpacity(value){opacity=clamp(value,0,1);status();},setMirror(value){mirror=value;status();},setGrid(value){grid=value;position();},setSpace(value){space=value;position();},
      fit(){const width=viewport.clientWidth,height=viewport.clientHeight;view={zoom:clamp(Math.floor(Math.min((width-64)/canvas.width,(height-64)/canvas.height)),1,32),x:0,y:0};view.x=(width-canvas.width*view.zoom)/2;view.y=(height-canvas.height*view.zoom)/2;position();},
      zoom(value){if(gesture)return;view=zoomAt(view,value,viewport.clientWidth/2,viewport.clientHeight/2);position();},
      undo(){finish();if(!undo.length)return;redo.push(snapshot());ctx.putImageData(undo.pop(),0,0);changed();status();},redo(){finish();if(!redo.length)return;undo.push(snapshot());ctx.putImageData(redo.pop(),0,0);changed();status();},
      flip(horizontal){finish();const before=snapshot(),after=snapshot(),w=canvas.width,h=canvas.height;for(let y=0;y<h;y++)for(let x=0;x<w;x++){const source=((horizontal?y:h-1-y)*w+(horizontal?w-1-x:x))*4;after.data.set(before.data.slice(source,source+4),(y*w+x)*4);}ctx.putImageData(after,0,0);commit(before);},
      get view(){return {...view};},get tool(){return tool;},get data(){finish();return canvas.toDataURL('image/png');},
      dispose(){finish();disposed=true;if(frame!==null)cancelAnimationFrame(frame);events.forEach(remove=>remove());}
    };
    api.fit();return api;
  }
  const api={create,imagePoint,zoomAt,floodPixels};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PixelEditor=api;
})(typeof window!=='undefined'?window:globalThis);
