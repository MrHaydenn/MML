const test=require('node:test'),assert=require('node:assert/strict');
const {imagePoint,zoomAt,floodPixels}=require('../src/pixel-editor.js');
test('zoom keeps the pixel beneath the cursor stationary and clamps canvas magnification',()=>{
 const view={zoom:8,x:30,y:40},before=imagePoint(110,120,view),after=zoomAt(view,16,110,120);assert.deepEqual(imagePoint(110,120,after),before);assert.equal(zoomAt(view,100,0,0).zoom,64);assert.equal(zoomAt(view,.01,0,0).zoom,1);
});
test('pan coordinates map back to the correct pixel and retain out-of-bounds positions',()=>{
 assert.deepEqual(imagePoint(45,61,{zoom:4,x:5,y:21}),{x:10,y:10});assert.deepEqual(imagePoint(1,1,{zoom:8,x:20,y:20}),{x:-3,y:-3});
});
test('fill respects connected boundaries and transparency and ignores unchanged or outside pixels',()=>{
 const bytes=new Uint8ClampedArray(4*3*4);for(let y=0;y<3;y++)bytes.set([0,0,0,255],(y*4+2)*4);
 assert.equal(floodPixels(bytes,4,3,0,0,[10,20,30,128]),true);assert.deepEqual([...bytes.slice(0,4)],[10,20,30,128]);assert.deepEqual([...bytes.slice(12,16)],[0,0,0,0]);assert.deepEqual([...bytes.slice(8,12)],[0,0,0,255]);assert.equal(floodPixels(bytes,4,3,0,0,[10,20,30,128]),false);assert.equal(floodPixels(bytes,4,3,-1,0,[1,1,1,255]),false);
});
