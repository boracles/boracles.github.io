// QR decoding runs away from the animation / microphone UI thread.
importScripts('assets/vendor/jsQR.js');
self.onmessage=({data})=>{
  try{
    const pixels=new Uint8ClampedArray(data.pixels);
    const code=self.jsQR(pixels,data.width,data.height,{inversionAttempts:'dontInvert'});
    self.postMessage({code});
  }catch(error){self.postMessage({error:error.message});}
};
