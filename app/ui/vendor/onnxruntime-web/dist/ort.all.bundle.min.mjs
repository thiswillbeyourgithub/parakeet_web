/*!
 * ONNX Runtime Web v1.27.0
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
var i2=Object.create;var ci=Object.defineProperty;var a2=Object.getOwnPropertyDescriptor;var s2=Object.getOwnPropertyNames;var u2=Object.getPrototypeOf,l2=Object.prototype.hasOwnProperty;var jr=(r=>typeof require<"u"?require:typeof Proxy<"u"?new Proxy(r,{get:(e,n)=>(typeof require<"u"?require:e)[n]}):r)(function(r){if(typeof require<"u")return require.apply(this,arguments);throw Error('Dynamic require of "'+r+'" is not supported')});var L=(r,e)=>()=>(r&&(e=r(r=0)),e);var ie=(r,e)=>()=>(e||r((e={exports:{}}).exports,e),e.exports),Ir=(r,e)=>{for(var n in e)ci(r,n,{get:e[n],enumerable:!0})},Fp=(r,e,n,t)=>{if(e&&typeof e=="object"||typeof e=="function")for(let o of s2(e))!l2.call(r,o)&&o!==n&&ci(r,o,{get:()=>e[o],enumerable:!(t=a2(e,o))||t.enumerable});return r};var ve=(r,e,n)=>(n=r!=null?i2(u2(r)):{},Fp(e||!r||!r.__esModule?ci(n,"default",{value:r,enumerable:!0}):n,r)),Kr=r=>Fp(ci({},"__esModule",{value:!0}),r);var di,Sr,ar,c2,Wp,Ds=L(()=>{"use strict";di=new Map,Sr=[],ar=(r,e,n)=>{if(e&&typeof e.init=="function"&&typeof e.createInferenceSessionHandler=="function"){let t=di.get(r);if(t===void 0)di.set(r,{backend:e,priority:n});else{if(t.priority>n)return;if(t.priority===n&&t.backend!==e)throw new Error(`cannot register backend "${r}" using priority ${n}`)}if(n>=0){let o=Sr.indexOf(r);o!==-1&&Sr.splice(o,1);for(let i=0;i<Sr.length;i++)if(di.get(Sr[i]).priority<=n){Sr.splice(i,0,r);return}Sr.push(r)}return}throw new TypeError("not a valid backend")},c2=async r=>{let e=di.get(r);if(!e)return"backend not found.";if(e.initialized)return e.backend;if(e.aborted)return e.error;{let n=!!e.initPromise;try{return n||(e.initPromise=e.backend.init(r)),await e.initPromise,e.initialized=!0,e.backend}catch(t){return n||(e.error=`${t}`,e.aborted=!0),e.error}finally{delete e.initPromise}}},Wp=async r=>{let e=r.executionProviders||[],n=e.map(u=>typeof u=="string"?u:u.name),t=n.length===0?Sr:n,o,i=[],a=new Set;for(let u of t){let l=await c2(u);typeof l=="string"?i.push({name:u,err:l}):(o||(o=l),o===l&&a.add(u))}if(!o)throw new Error(`no available backend found. ERR: ${i.map(u=>`[${u.name}] ${u.err}`).join(", ")}`);for(let{name:u,err:l}of i)n.includes(u)&&console.warn(`removing requested execution provider "${u}" from session options because it is not available: ${l}`);let s=e.filter(u=>a.has(typeof u=="string"?u:u.name));return[o,new Proxy(r,{get:(u,l)=>l==="executionProviders"?s:Reflect.get(u,l)})]}});var Hp=L(()=>{"use strict";Ds()});var qp,jp=L(()=>{"use strict";qp="1.27.0"});var Kp,ut,ks=L(()=>{"use strict";jp();Kp="warning",ut={wasm:{},webgl:{},webgpu:{},versions:{common:qp},set logLevel(r){if(r!==void 0){if(typeof r!="string"||["verbose","info","warning","error","fatal"].indexOf(r)===-1)throw new Error(`Unsupported logging level: ${r}`);Kp=r}},get logLevel(){return Kp}};Object.defineProperty(ut,"logLevel",{enumerable:!0})});var he,Xp=L(()=>{"use strict";ks();he=ut});var Zp,Jp,Yp=L(()=>{"use strict";Zp=(r,e)=>{let n=typeof document<"u"?document.createElement("canvas"):new OffscreenCanvas(1,1);n.width=r.dims[3],n.height=r.dims[2];let t=n.getContext("2d");if(t!=null){let o,i;e?.tensorLayout!==void 0&&e.tensorLayout==="NHWC"?(o=r.dims[2],i=r.dims[3]):(o=r.dims[3],i=r.dims[2]);let a=e?.format!==void 0?e.format:"RGB",s=e?.norm,u,l;s===void 0||s.mean===void 0?u=[255,255,255,255]:typeof s.mean=="number"?u=[s.mean,s.mean,s.mean,s.mean]:(u=[s.mean[0],s.mean[1],s.mean[2],0],s.mean[3]!==void 0&&(u[3]=s.mean[3])),s===void 0||s.bias===void 0?l=[0,0,0,0]:typeof s.bias=="number"?l=[s.bias,s.bias,s.bias,s.bias]:(l=[s.bias[0],s.bias[1],s.bias[2],0],s.bias[3]!==void 0&&(l[3]=s.bias[3]));let d=i*o,p=0,h=d,g=d*2,b=-1;a==="RGBA"?(p=0,h=d,g=d*2,b=d*3):a==="RGB"?(p=0,h=d,g=d*2):a==="RBG"&&(p=0,g=d,h=d*2);for(let _=0;_<i;_++)for(let S=0;S<o;S++){let v=(r.data[p++]-l[0])*u[0],x=(r.data[h++]-l[1])*u[1],$=(r.data[g++]-l[2])*u[2],O=b===-1?255:(r.data[b++]-l[3])*u[3];t.fillStyle="rgba("+v+","+x+","+$+","+O+")",t.fillRect(S,_,1,1)}if("toDataURL"in n)return n.toDataURL();throw new Error("toDataURL is not supported")}else throw new Error("Can not access image data")},Jp=(r,e)=>{let n=typeof document<"u"?document.createElement("canvas").getContext("2d"):new OffscreenCanvas(1,1).getContext("2d"),t;if(n!=null){let o,i,a;e?.tensorLayout!==void 0&&e.tensorLayout==="NHWC"?(o=r.dims[2],i=r.dims[1],a=r.dims[3]):(o=r.dims[3],i=r.dims[2],a=r.dims[1]);let s=e!==void 0&&e.format!==void 0?e.format:"RGB",u=e?.norm,l,d;u===void 0||u.mean===void 0?l=[255,255,255,255]:typeof u.mean=="number"?l=[u.mean,u.mean,u.mean,u.mean]:(l=[u.mean[0],u.mean[1],u.mean[2],255],u.mean[3]!==void 0&&(l[3]=u.mean[3])),u===void 0||u.bias===void 0?d=[0,0,0,0]:typeof u.bias=="number"?d=[u.bias,u.bias,u.bias,u.bias]:(d=[u.bias[0],u.bias[1],u.bias[2],0],u.bias[3]!==void 0&&(d[3]=u.bias[3]));let p=i*o;if(e!==void 0&&(e.format!==void 0&&a===4&&e.format!=="RGBA"||a===3&&e.format!=="RGB"&&e.format!=="BGR"))throw new Error("Tensor format doesn't match input tensor dims");let h=4,g=0,b=1,_=2,S=3,v=0,x=p,$=p*2,O=-1;s==="RGBA"?(v=0,x=p,$=p*2,O=p*3):s==="RGB"?(v=0,x=p,$=p*2):s==="RBG"&&(v=0,$=p,x=p*2),t=n.createImageData(o,i);for(let E=0;E<i*o;g+=h,b+=h,_+=h,S+=h,E++)t.data[g]=(r.data[v++]-d[0])*l[0],t.data[b]=(r.data[x++]-d[1])*l[1],t.data[_]=(r.data[$++]-d[2])*l[2],t.data[S]=O===-1?255:(r.data[O++]-d[3])*l[3]}else throw new Error("Can not access image data");return t}});var Ns,Qp,ef,tf,nf,rf,of=L(()=>{"use strict";pi();Ns=(r,e)=>{if(r===void 0)throw new Error("Image buffer must be defined");if(e.height===void 0||e.width===void 0)throw new Error("Image height and width must be defined");if(e.tensorLayout==="NHWC")throw new Error("NHWC Tensor layout is not supported yet");let{height:n,width:t}=e,o=e.norm??{mean:255,bias:0},i,a;typeof o.mean=="number"?i=[o.mean,o.mean,o.mean,o.mean]:i=[o.mean[0],o.mean[1],o.mean[2],o.mean[3]??255],typeof o.bias=="number"?a=[o.bias,o.bias,o.bias,o.bias]:a=[o.bias[0],o.bias[1],o.bias[2],o.bias[3]??0];let s=e.format!==void 0?e.format:"RGBA",u=e.tensorFormat!==void 0&&e.tensorFormat!==void 0?e.tensorFormat:"RGB",l=n*t,d=u==="RGBA"?new Float32Array(l*4):new Float32Array(l*3),p=4,h=0,g=1,b=2,_=3,S=0,v=l,x=l*2,$=-1;s==="RGB"&&(p=3,h=0,g=1,b=2,_=-1),u==="RGBA"?$=l*3:u==="RBG"?(S=0,x=l,v=l*2):u==="BGR"&&(x=0,v=l,S=l*2);for(let E=0;E<l;E++,h+=p,b+=p,g+=p,_+=p)d[S++]=(r[h]+a[0])/i[0],d[v++]=(r[g]+a[1])/i[1],d[x++]=(r[b]+a[2])/i[2],$!==-1&&_!==-1&&(d[$++]=(r[_]+a[3])/i[3]);return u==="RGBA"?new ft("float32",d,[1,4,n,t]):new ft("float32",d,[1,3,n,t])},Qp=async(r,e)=>{let n=typeof HTMLImageElement<"u"&&r instanceof HTMLImageElement,t=typeof ImageData<"u"&&r instanceof ImageData,o=typeof ImageBitmap<"u"&&r instanceof ImageBitmap,i=typeof r=="string",a,s=e??{},u=()=>{if(typeof document<"u")return document.createElement("canvas");if(typeof OffscreenCanvas<"u")return new OffscreenCanvas(1,1);throw new Error("Canvas is not supported")},l=d=>typeof HTMLCanvasElement<"u"&&d instanceof HTMLCanvasElement||d instanceof OffscreenCanvas?d.getContext("2d"):null;if(n){let d=u();d.width=r.width,d.height=r.height;let p=l(d);if(p!=null){let h=r.height,g=r.width;if(e!==void 0&&e.resizedHeight!==void 0&&e.resizedWidth!==void 0&&(h=e.resizedHeight,g=e.resizedWidth),e!==void 0){if(s=e,e.tensorFormat!==void 0)throw new Error("Image input config format must be RGBA for HTMLImageElement");s.tensorFormat="RGBA",s.height=h,s.width=g}else s.tensorFormat="RGBA",s.height=h,s.width=g;p.drawImage(r,0,0),a=p.getImageData(0,0,g,h).data}else throw new Error("Can not access image data")}else if(t){let d,p;if(e!==void 0&&e.resizedWidth!==void 0&&e.resizedHeight!==void 0?(d=e.resizedHeight,p=e.resizedWidth):(d=r.height,p=r.width),e!==void 0&&(s=e),s.format="RGBA",s.height=d,s.width=p,e!==void 0){let h=u();h.width=p,h.height=d;let g=l(h);if(g!=null)g.putImageData(r,0,0),a=g.getImageData(0,0,p,d).data;else throw new Error("Can not access image data")}else a=r.data}else if(o){if(e===void 0)throw new Error("Please provide image config with format for Imagebitmap");let d=u();d.width=r.width,d.height=r.height;let p=l(d);if(p!=null){let h=r.height,g=r.width;return p.drawImage(r,0,0,g,h),a=p.getImageData(0,0,g,h).data,s.height=h,s.width=g,Ns(a,s)}else throw new Error("Can not access image data")}else{if(i)return new Promise((d,p)=>{let h=u(),g=l(h);if(!r||!g)return p();let b=new Image;b.crossOrigin="Anonymous",b.src=r,b.onload=()=>{h.width=b.width,h.height=b.height,g.drawImage(b,0,0,h.width,h.height);let _=g.getImageData(0,0,h.width,h.height);s.height=h.height,s.width=h.width,d(Ns(_.data,s))}});throw new Error("Input data provided is not supported - aborted tensor creation")}if(a!==void 0)return Ns(a,s);throw new Error("Input data provided is not supported - aborted tensor creation")},ef=(r,e)=>{let{width:n,height:t,download:o,dispose:i}=e,a=[1,t,n,4];return new ft({location:"texture",type:"float32",texture:r,dims:a,download:o,dispose:i})},tf=(r,e)=>{let{dataType:n,dims:t,download:o,dispose:i}=e;return new ft({location:"gpu-buffer",type:n??"float32",gpuBuffer:r,dims:t,download:o,dispose:i})},nf=(r,e)=>{let{dataType:n,dims:t,download:o,dispose:i}=e;return new ft({location:"ml-tensor",type:n??"float32",mlTensor:r,dims:t,download:o,dispose:i})},rf=(r,e,n)=>new ft({location:"cpu-pinned",type:r,data:e,dims:n??[e.length]})});var $r,wo,af,sf,uf=L(()=>{"use strict";$r=new Map([["float32",Float32Array],["uint8",Uint8Array],["int8",Int8Array],["uint16",Uint16Array],["int16",Int16Array],["int32",Int32Array],["bool",Uint8Array],["float64",Float64Array],["uint32",Uint32Array],["int4",Uint8Array],["uint4",Uint8Array]]),wo=new Map([[Float32Array,"float32"],[Uint8Array,"uint8"],[Int8Array,"int8"],[Uint16Array,"uint16"],[Int16Array,"int16"],[Int32Array,"int32"],[Float64Array,"float64"],[Uint32Array,"uint32"]]),af=!1,sf=()=>{if(!af){af=!0;let r=typeof BigInt64Array<"u"&&BigInt64Array.from,e=typeof BigUint64Array<"u"&&BigUint64Array.from,n=globalThis.Float16Array,t=typeof n<"u"&&n.from;r&&($r.set("int64",BigInt64Array),wo.set(BigInt64Array,"int64")),e&&($r.set("uint64",BigUint64Array),wo.set(BigUint64Array,"uint64")),t?($r.set("float16",n),wo.set(n,"float16")):$r.set("float16",Uint16Array)}}});var lf,cf,df=L(()=>{"use strict";pi();lf=r=>{let e=1;for(let n=0;n<r.length;n++){let t=r[n];if(typeof t!="number"||!Number.isSafeInteger(t))throw new TypeError(`dims[${n}] must be an integer, got: ${t}`);if(t<0)throw new RangeError(`dims[${n}] must be a non-negative integer, got: ${t}`);e*=t}return e},cf=(r,e)=>{switch(r.location){case"cpu":return new ft(r.type,r.data,e);case"cpu-pinned":return new ft({location:"cpu-pinned",data:r.data,type:r.type,dims:e});case"texture":return new ft({location:"texture",texture:r.texture,type:r.type,dims:e});case"gpu-buffer":return new ft({location:"gpu-buffer",gpuBuffer:r.gpuBuffer,type:r.type,dims:e});case"ml-tensor":return new ft({location:"ml-tensor",mlTensor:r.mlTensor,type:r.type,dims:e});default:throw new Error(`tensorReshape: tensor location ${r.location} is not supported`)}}});var ft,pi=L(()=>{"use strict";Yp();of();uf();df();ft=class{constructor(e,n,t){sf();let o,i;if(typeof e=="object"&&"location"in e)switch(this.dataLocation=e.location,o=e.type,i=e.dims,e.location){case"cpu-pinned":{let s=$r.get(o);if(!s)throw new TypeError(`unsupported type "${o}" to create tensor from pinned buffer`);if(!(e.data instanceof s))throw new TypeError(`buffer should be of type ${s.name}`);this.cpuData=e.data;break}case"texture":{if(o!=="float32")throw new TypeError(`unsupported type "${o}" to create tensor from texture`);this.gpuTextureData=e.texture,this.downloader=e.download,this.disposer=e.dispose;break}case"gpu-buffer":{if(o!=="float32"&&o!=="float16"&&o!=="int32"&&o!=="int64"&&o!=="uint32"&&o!=="uint8"&&o!=="bool"&&o!=="uint4"&&o!=="int4")throw new TypeError(`unsupported type "${o}" to create tensor from gpu buffer`);this.gpuBufferData=e.gpuBuffer,this.downloader=e.download,this.disposer=e.dispose;break}case"ml-tensor":{if(o!=="float32"&&o!=="float16"&&o!=="int32"&&o!=="int64"&&o!=="uint32"&&o!=="uint64"&&o!=="int8"&&o!=="uint8"&&o!=="bool"&&o!=="uint4"&&o!=="int4")throw new TypeError(`unsupported type "${o}" to create tensor from MLTensor`);this.mlTensorData=e.mlTensor,this.downloader=e.download,this.disposer=e.dispose;break}default:throw new Error(`Tensor constructor: unsupported location '${this.dataLocation}'`)}else{let s,u;if(typeof e=="string")if(o=e,u=t,e==="string"){if(!Array.isArray(n))throw new TypeError("A string tensor's data must be a string array.");s=n}else{let l=$r.get(e);if(l===void 0)throw new TypeError(`Unsupported tensor type: ${e}.`);if(Array.isArray(n)){if(e==="float16"&&l===Uint16Array||e==="uint4"||e==="int4")throw new TypeError(`Creating a ${e} tensor from number array is not supported. Please use ${l.name} as data.`);e==="uint64"||e==="int64"?s=l.from(n,BigInt):s=l.from(n)}else if(n instanceof l)s=n;else if(n instanceof Uint8ClampedArray)if(e==="uint8")s=Uint8Array.from(n);else throw new TypeError("A Uint8ClampedArray tensor's data must be type of uint8");else if(e==="float16"&&n instanceof Uint16Array&&l!==Uint16Array)s=new globalThis.Float16Array(n.buffer,n.byteOffset,n.length);else throw new TypeError(`A ${o} tensor's data must be type of ${l}`)}else if(u=n,Array.isArray(e)){if(e.length===0)throw new TypeError("Tensor type cannot be inferred from an empty array.");let l=typeof e[0];if(l==="string")o="string",s=e;else if(l==="boolean")o="bool",s=Uint8Array.from(e);else throw new TypeError(`Invalid element type of data array: ${l}.`)}else if(e instanceof Uint8ClampedArray)o="uint8",s=Uint8Array.from(e);else{let l=wo.get(e.constructor);if(l===void 0)throw new TypeError(`Unsupported type for tensor data: ${e.constructor}.`);o=l,s=e}if(u===void 0)u=[s.length];else if(!Array.isArray(u))throw new TypeError("A tensor's dims must be a number array");i=u,this.cpuData=s,this.dataLocation="cpu"}let a=lf(i);if(this.cpuData&&a!==this.cpuData.length&&!((o==="uint4"||o==="int4")&&Math.ceil(a/2)===this.cpuData.length))throw new Error(`Tensor's size(${a}) does not match data length(${this.cpuData.length}).`);this.type=o,this.dims=i,this.size=a}static async fromImage(e,n){return Qp(e,n)}static fromTexture(e,n){return ef(e,n)}static fromGpuBuffer(e,n){return tf(e,n)}static fromMLTensor(e,n){return nf(e,n)}static fromPinnedBuffer(e,n,t){return rf(e,n,t)}toDataURL(e){return Zp(this,e)}toImageData(e){return Jp(this,e)}get data(){if(this.ensureValid(),!this.cpuData)throw new Error("The data is not on CPU. Use `getData()` to download GPU data to CPU, or use `texture` or `gpuBuffer` property to access the GPU data directly.");return this.cpuData}get location(){return this.dataLocation}get texture(){if(this.ensureValid(),!this.gpuTextureData)throw new Error("The data is not stored as a WebGL texture.");return this.gpuTextureData}get gpuBuffer(){if(this.ensureValid(),!this.gpuBufferData)throw new Error("The data is not stored as a WebGPU buffer.");return this.gpuBufferData}get mlTensor(){if(this.ensureValid(),!this.mlTensorData)throw new Error("The data is not stored as a WebNN MLTensor.");return this.mlTensorData}async getData(e){switch(this.ensureValid(),this.dataLocation){case"cpu":case"cpu-pinned":return this.data;case"texture":case"gpu-buffer":case"ml-tensor":{if(!this.downloader)throw new Error("The current tensor is not created with a specified data downloader.");if(this.isDownloading)throw new Error("The current tensor is being downloaded.");try{this.isDownloading=!0;let n=await this.downloader();return this.downloader=void 0,this.dataLocation="cpu",this.cpuData=n,e&&this.disposer&&(this.disposer(),this.disposer=void 0),n}finally{this.isDownloading=!1}}default:throw new Error(`cannot get data from location: ${this.dataLocation}`)}}dispose(){if(this.isDownloading)throw new Error("The current tensor is being downloaded.");this.disposer&&(this.disposer(),this.disposer=void 0),this.cpuData=void 0,this.gpuTextureData=void 0,this.gpuBufferData=void 0,this.mlTensorData=void 0,this.downloader=void 0,this.isDownloading=void 0,this.dataLocation="none"}ensureValid(){if(this.dataLocation==="none")throw new Error("The tensor is disposed.")}reshape(e){if(this.ensureValid(),this.downloader||this.disposer)throw new Error("Cannot reshape a tensor that owns GPU resource.");return cf(this,e)}}});var $t,Ls=L(()=>{"use strict";pi();$t=ft});var fi,pf,At,_t,sr,ur,Rs=L(()=>{"use strict";ks();fi=(r,e)=>{(typeof ut.trace>"u"?!ut.wasm.trace:!ut.trace)||console.timeStamp(`${r}::ORT::${e}`)},pf=(r,e)=>{let n=new Error().stack?.split(/\r\n|\r|\n/g)||[],t=!1;for(let o=0;o<n.length;o++){if(t&&!n[o].includes("TRACE_FUNC")){let i=`FUNC_${r}::${n[o].trim().split(" ")[1]}`;e&&(i+=`::${e}`),fi("CPU",i);return}n[o].includes("TRACE_FUNC")&&(t=!0)}},At=r=>{(typeof ut.trace>"u"?!ut.wasm.trace:!ut.trace)||pf("BEGIN",r)},_t=r=>{(typeof ut.trace>"u"?!ut.wasm.trace:!ut.trace)||pf("END",r)},sr=r=>{(typeof ut.trace>"u"?!ut.wasm.trace:!ut.trace)||console.time(`ORT::${r}`)},ur=r=>{(typeof ut.trace>"u"?!ut.wasm.trace:!ut.trace)||console.timeEnd(`ORT::${r}`)}});var hi,ff=L(()=>{"use strict";Ds();Ls();Rs();hi=class r{constructor(e){this.handler=e}async run(e,n,t){At(),sr("InferenceSession.run");let o={},i={};if(typeof e!="object"||e===null||e instanceof $t||Array.isArray(e))throw new TypeError("'feeds' must be an object that use input names as keys and OnnxValue as corresponding values.");let a=!0;if(typeof n=="object"){if(n===null)throw new TypeError("Unexpected argument[1]: cannot be null.");if(n instanceof $t)throw new TypeError("'fetches' cannot be a Tensor");if(Array.isArray(n)){if(n.length===0)throw new TypeError("'fetches' cannot be an empty array.");a=!1;for(let l of n){if(typeof l!="string")throw new TypeError("'fetches' must be a string array or an object.");if(this.outputNames.indexOf(l)===-1)throw new RangeError(`'fetches' contains invalid output name: ${l}.`);o[l]=null}if(typeof t=="object"&&t!==null)i=t;else if(typeof t<"u")throw new TypeError("'options' must be an object.")}else{let l=!1,d=Object.getOwnPropertyNames(n);for(let p of this.outputNames)if(d.indexOf(p)!==-1){let h=n[p];(h===null||h instanceof $t)&&(l=!0,a=!1,o[p]=h)}if(l){if(typeof t=="object"&&t!==null)i=t;else if(typeof t<"u")throw new TypeError("'options' must be an object.")}else i=n}}else if(typeof n<"u")throw new TypeError("Unexpected argument[1]: must be 'fetches' or 'options'.");for(let l of this.inputNames)if(typeof e[l]>"u")throw new Error(`input '${l}' is missing in 'feeds'.`);if(a)for(let l of this.outputNames)o[l]=null;let s=await this.handler.run(e,o,i),u={};for(let l in s)if(Object.hasOwnProperty.call(s,l)){let d=s[l];d instanceof $t?u[l]=d:u[l]=new $t(d.type,d.data,d.dims)}return ur("InferenceSession.run"),_t(),u}async release(){return this.handler.dispose()}static async create(e,n,t,o){At(),sr("InferenceSession.create");let i,a={};if(typeof e=="string"){if(i=e,typeof n=="object"&&n!==null)a=n;else if(typeof n<"u")throw new TypeError("'options' must be an object.")}else if(e instanceof Uint8Array){if(i=e,typeof n=="object"&&n!==null)a=n;else if(typeof n<"u")throw new TypeError("'options' must be an object.")}else if(e instanceof ArrayBuffer||typeof SharedArrayBuffer<"u"&&e instanceof SharedArrayBuffer){let d=e,p=0,h=e.byteLength;if(typeof n=="object"&&n!==null)a=n;else if(typeof n=="number"){if(p=n,!Number.isSafeInteger(p))throw new RangeError("'byteOffset' must be an integer.");if(p<0||p>=d.byteLength)throw new RangeError(`'byteOffset' is out of range [0, ${d.byteLength}).`);if(h=e.byteLength-p,typeof t=="number"){if(h=t,!Number.isSafeInteger(h))throw new RangeError("'byteLength' must be an integer.");if(h<=0||p+h>d.byteLength)throw new RangeError(`'byteLength' is out of range (0, ${d.byteLength-p}].`);if(typeof o=="object"&&o!==null)a=o;else if(typeof o<"u")throw new TypeError("'options' must be an object.")}else if(typeof t<"u")throw new TypeError("'byteLength' must be a number.")}else if(typeof n<"u")throw new TypeError("'options' must be an object.");i=new Uint8Array(d,p,h)}else throw new TypeError("Unexpected argument[0]: must be 'path' or 'buffer'.");let[s,u]=await Wp(a),l=await s.createInferenceSessionHandler(i,u);return ur("InferenceSession.create"),_t(),new r(l)}startProfiling(){this.handler.startProfiling()}endProfiling(){this.handler.endProfiling()}get inputNames(){return this.handler.inputNames}get outputNames(){return this.handler.outputNames}get inputMetadata(){return this.handler.inputMetadata}get outputMetadata(){return this.handler.outputMetadata}}});var d2,hf=L(()=>{"use strict";ff();d2=hi});var mf=L(()=>{"use strict"});var gf=L(()=>{"use strict"});var bf=L(()=>{"use strict"});var yf=L(()=>{"use strict"});var zs={};Ir(zs,{InferenceSession:()=>d2,TRACE:()=>fi,TRACE_EVENT_BEGIN:()=>sr,TRACE_EVENT_END:()=>ur,TRACE_FUNC_BEGIN:()=>At,TRACE_FUNC_END:()=>_t,Tensor:()=>$t,env:()=>he,registerBackend:()=>ar});var ht=L(()=>{"use strict";Hp();Xp();hf();Ls();mf();gf();Rs();bf();yf()});function lr(r,e,n,t){if(e===void 0)return f2(r);if(n===void 0)mi(r,e,1);else if(typeof n=="number"&&t===void 0)mi(r,e,n);else if(typeof n=="string"&&t===void 0)mi(r,n,1,e);else if(typeof n=="string"&&typeof t=="number")mi(r,n,t,e);else throw new TypeError("input is valid")}function f2(r){return{verbose:lr.verbose.bind(null,r),info:lr.info.bind(null,r),warning:lr.warning.bind(null,r),error:lr.error.bind(null,r),fatal:lr.fatal.bind(null,r)}}function mi(r,e,n,t){let o=vo[t||""]||vo[""];wf[r]<wf[o.minimalSeverity]||(o.logDateTime&&(e=`${new Date().toISOString()}|${e}`),o.logSourceLocation,p2[o.provider].log(r,e,t))}var Ms,Bs,wf,p2,vf,vo,Ge,bi,yi,_i,gi,Dt=L(()=>{"use strict";Ms=class{log(e,n,t){}},Bs=class{log(e,n,t){console.log(`${this.color(e)} ${t?"\x1B[35m"+t+"\x1B[0m ":""}${n}`)}color(e){switch(e){case"verbose":return"\x1B[34;40mv\x1B[0m";case"info":return"\x1B[32mi\x1B[0m";case"warning":return"\x1B[30;43mw\x1B[0m";case"error":return"\x1B[31;40me\x1B[0m";case"fatal":return"\x1B[101mf\x1B[0m";default:throw new Error(`unsupported severity: ${e}`)}}},wf={verbose:1e3,info:2e3,warning:4e3,error:5e3,fatal:6e3},p2={none:new Ms,console:new Bs},vf={provider:"console",minimalSeverity:"warning",logDateTime:!0,logSourceLocation:!1},vo={"":vf};(u=>{function r(l,d){u("verbose",l,d)}u.verbose=r;function e(l,d){u("info",l,d)}u.info=e;function n(l,d){u("warning",l,d)}u.warning=n;function t(l,d){u("error",l,d)}u.error=t;function o(l,d){u("fatal",l,d)}u.fatal=o;function i(l){vo={},a("",l||{})}u.reset=i;function a(l,d){if(l==="*")i(d);else{let p=vo[l]||vf;vo[l]={provider:d.provider||p.provider,minimalSeverity:d.minimalSeverity||p.minimalSeverity,logDateTime:d.logDateTime===void 0?p.logDateTime:d.logDateTime,logSourceLocation:d.logSourceLocation===void 0?p.logSourceLocation:d.logSourceLocation}}}u.set=a;function s(l){let d={};l.logLevel&&(d.minimalSeverity=l.logLevel),a("",d)}u.setWithEnv=s})(lr||={});Ge=lr,bi=class{constructor(e,n,t,o,i,a){this.category=e;this.name=n;this.startTime=t;this.endCallback=o;this.timer=i;this.ctx=a}async end(){return this.endCallback(this)}async checkTimer(){if(this.ctx===void 0||this.timer===void 0)throw new Error("No webgl timer found");return this.ctx.endTimer(),this.ctx.waitForQueryAndGetTime(this.timer)}},yi=class{constructor(e,n,t,o){this.category=e;this.name=n;this.startTime=t;this.endTime=o}},_i=class{constructor(e,n,t){this._started=!1;this._flushPointer=0;this._started=!1,this._maxNumberEvents=e===void 0?1e4:e,this._flushBatchSize=n===void 0?10:n,this._flushIntervalInMilliseconds=t===void 0?5e3:t}static create(e){return e===void 0?new this:new this(e.maxNumberEvents,e.flushBatchSize,e.flushIntervalInMilliseconds)}start(){this._started=!0,this._timingEvents=[],this._flushTime=gi(),this._flushPointer=0}stop(){for(this._started=!1;this._flushPointer<this._timingEvents.length;this._flushPointer++)this.logOneEvent(this._timingEvents[this._flushPointer])}event(e,n,t,o){let i=this._started?this.begin(e,n,o):void 0,a=!1,s=t();if(s&&typeof s.then=="function")return a=!0,new Promise((u,l)=>{s.then(async d=>{i&&await i.end(),u(d)},async d=>{i&&await i.end(),l(d)})});if(!a&&i){let u=i.end();if(u&&typeof u.then=="function")return new Promise((l,d)=>{u.then(()=>{l(s)},p=>{d(p)})})}return s}begin(e,n,t){if(!this._started)throw new Error("profiler is not started yet");if(t===void 0){let o=gi();return this.flush(o),new bi(e,n,o,i=>this.endSync(i))}else{let o=t.beginTimer();return new bi(e,n,0,async i=>this.end(i),o,t)}}async end(e){let n=await e.checkTimer();this._timingEvents.length<this._maxNumberEvents&&(this._timingEvents.push(new yi(e.category,e.name,e.startTime,n)),this.flush(n))}endSync(e){let n=gi();this._timingEvents.length<this._maxNumberEvents&&(this._timingEvents.push(new yi(e.category,e.name,e.startTime,n)),this.flush(n))}logOneEvent(e){Ge.verbose(`Profiler.${e.category}`,`${(e.endTime-e.startTime).toFixed(2)}ms on event '${e.name}' at ${e.endTime.toFixed(2)}`)}flush(e){if(this._timingEvents.length-this._flushPointer>=this._flushBatchSize||e-this._flushTime>=this._flushIntervalInMilliseconds){for(let n=this._flushPointer;this._flushPointer<n+this._flushBatchSize&&this._flushPointer<this._timingEvents.length;this._flushPointer++)this.logOneEvent(this._timingEvents[this._flushPointer]);this._flushTime=gi()}}get started(){return this._started}},gi=typeof performance<"u"&&performance.now?()=>performance.now():Date.now});function xf(r,e,n){for(let t of n){let o=t[0],i=t[1],a=t[2],s=t[3],u=t[4];if(r.opType===o){for(let l of e)if((l.domain===i||l.domain==="ai.onnx"&&i==="")&&h2(l.version,a))return{opImpl:s,opInit:u}}}throw new TypeError(`cannot resolve operator '${r.opType}' with opsets: ${e.map(t=>`${t.domain||"ai.onnx"} v${t.version}`).join(", ")}`)}function h2(r,e){if(e.endsWith("+")){let n=Number.parseInt(e.substring(0,e.length-1),10);return!isNaN(n)&&n<=r}else if(e.split("-").length===2){let n=e.split("-"),t=Number.parseInt(n[0],10),o=Number.parseInt(n[1],10);return!isNaN(t)&&!isNaN(o)&&t<=r&&r<=o}else return Number.parseInt(e,10)===r}var Tf=L(()=>{"use strict"});var If=ie(Vs=>{"use strict";Vs.__esModule=!0;var m2=(function(){function r(e){if(!e)throw new TypeError("Invalid argument; `value` has no value.");this.value=r.EMPTY,e&&r.isGuid(e)&&(this.value=e)}return r.isGuid=function(e){var n=e.toString();return e&&(e instanceof r||r.validator.test(n))},r.create=function(){return new r([r.gen(2),r.gen(1),r.gen(1),r.gen(1),r.gen(3)].join("-"))},r.createEmpty=function(){return new r("emptyguid")},r.parse=function(e){return new r(e)},r.raw=function(){return[r.gen(2),r.gen(1),r.gen(1),r.gen(1),r.gen(3)].join("-")},r.gen=function(e){for(var n="",t=0;t<e;t++)n+=((1+Math.random())*65536|0).toString(16).substring(1);return n},r.prototype.equals=function(e){return r.isGuid(e)&&this.value===e.toString()},r.prototype.isEmpty=function(){return this.value===r.EMPTY},r.prototype.toString=function(){return this.value},r.prototype.toJSON=function(){return{value:this.value}},r.validator=new RegExp("^[a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12}$","i"),r.EMPTY="00000000-0000-0000-0000-000000000000",r})();Vs.Guid=m2});function He(r,e,n){this.low=r|0,this.high=e|0,this.unsigned=!!n}function gt(r){return(r&&r.__isLong__)===!0}function Sf(r){var e=Math.clz32(r&-r);return r?31-e:e}function Ar(r,e){var n,t,o;return e?(r>>>=0,(o=0<=r&&r<256)&&(t=Af[r],t)?t:(n=Ne(r,0,!0),o&&(Af[r]=n),n)):(r|=0,(o=-128<=r&&r<128)&&(t=$f[r],t)?t:(n=Ne(r,r<0?-1:0,!1),o&&($f[r]=n),n))}function Nt(r,e){if(isNaN(r))return e?Jn:qt;if(e){if(r<0)return Jn;if(r>=Cf)return Nf}else{if(r<=-Pf)return wt;if(r+1>=Pf)return kf}return r<0?Nt(-r,e).neg():Ne(r%Zr|0,r/Zr|0,e)}function Ne(r,e,n){return new He(r,e,n)}function Us(r,e,n){if(r.length===0)throw Error("empty string");if(typeof e=="number"?(n=e,e=!1):e=!!e,r==="NaN"||r==="Infinity"||r==="+Infinity"||r==="-Infinity")return e?Jn:qt;if(n=n||10,n<2||36<n)throw RangeError("radix");var t;if((t=r.indexOf("-"))>0)throw Error("interior hyphen");if(t===0)return Us(r.substring(1),e,n).neg();for(var o=Nt(wi(n,8)),i=qt,a=0;a<r.length;a+=8){var s=Math.min(8,r.length-a),u=parseInt(r.substring(a,a+s),n);if(s<8){var l=Nt(wi(n,s));i=i.mul(l).add(Nt(u))}else i=i.mul(o),i=i.add(Nt(u))}return i.unsigned=e,i}function Lt(r,e){return typeof r=="number"?Nt(r,e):typeof r=="string"?Us(r,e):Ne(r.low,r.high,typeof e=="boolean"?e:r.unsigned)}var kt,$f,Af,wi,Of,g2,Zr,Cf,Pf,Ef,qt,Jn,Xr,Df,Gs,kf,Nf,wt,X,cr,Fs=L(()=>{kt=null;try{kt=new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0,1,13,2,96,0,1,127,96,4,127,127,127,127,1,127,3,7,6,0,1,1,1,1,1,6,6,1,127,1,65,0,11,7,50,6,3,109,117,108,0,1,5,100,105,118,95,115,0,2,5,100,105,118,95,117,0,3,5,114,101,109,95,115,0,4,5,114,101,109,95,117,0,5,8,103,101,116,95,104,105,103,104,0,0,10,191,1,6,4,0,35,0,11,36,1,1,126,32,0,173,32,1,173,66,32,134,132,32,2,173,32,3,173,66,32,134,132,126,34,4,66,32,135,167,36,0,32,4,167,11,36,1,1,126,32,0,173,32,1,173,66,32,134,132,32,2,173,32,3,173,66,32,134,132,127,34,4,66,32,135,167,36,0,32,4,167,11,36,1,1,126,32,0,173,32,1,173,66,32,134,132,32,2,173,32,3,173,66,32,134,132,128,34,4,66,32,135,167,36,0,32,4,167,11,36,1,1,126,32,0,173,32,1,173,66,32,134,132,32,2,173,32,3,173,66,32,134,132,129,34,4,66,32,135,167,36,0,32,4,167,11,36,1,1,126,32,0,173,32,1,173,66,32,134,132,32,2,173,32,3,173,66,32,134,132,130,34,4,66,32,135,167,36,0,32,4,167,11])),{}).exports}catch{}He.prototype.__isLong__;Object.defineProperty(He.prototype,"__isLong__",{value:!0});He.isLong=gt;$f={},Af={};He.fromInt=Ar;He.fromNumber=Nt;He.fromBits=Ne;wi=Math.pow;He.fromString=Us;He.fromValue=Lt;Of=65536,g2=1<<24,Zr=Of*Of,Cf=Zr*Zr,Pf=Cf/2,Ef=Ar(g2),qt=Ar(0);He.ZERO=qt;Jn=Ar(0,!0);He.UZERO=Jn;Xr=Ar(1);He.ONE=Xr;Df=Ar(1,!0);He.UONE=Df;Gs=Ar(-1);He.NEG_ONE=Gs;kf=Ne(-1,2147483647,!1);He.MAX_VALUE=kf;Nf=Ne(-1,-1,!0);He.MAX_UNSIGNED_VALUE=Nf;wt=Ne(0,-2147483648,!1);He.MIN_VALUE=wt;X=He.prototype;X.toInt=function(){return this.unsigned?this.low>>>0:this.low};X.toNumber=function(){return this.unsigned?(this.high>>>0)*Zr+(this.low>>>0):this.high*Zr+(this.low>>>0)};X.toString=function(e){if(e=e||10,e<2||36<e)throw RangeError("radix");if(this.isZero())return"0";if(this.isNegative())if(this.eq(wt)){var n=Nt(e),t=this.div(n),o=t.mul(n).sub(this);return t.toString(e)+o.toInt().toString(e)}else return"-"+this.neg().toString(e);for(var i=Nt(wi(e,6),this.unsigned),a=this,s="";;){var u=a.div(i),l=a.sub(u.mul(i)).toInt()>>>0,d=l.toString(e);if(a=u,a.isZero())return d+s;for(;d.length<6;)d="0"+d;s=""+d+s}};X.getHighBits=function(){return this.high};X.getHighBitsUnsigned=function(){return this.high>>>0};X.getLowBits=function(){return this.low};X.getLowBitsUnsigned=function(){return this.low>>>0};X.getNumBitsAbs=function(){if(this.isNegative())return this.eq(wt)?64:this.neg().getNumBitsAbs();for(var e=this.high!=0?this.high:this.low,n=31;n>0&&(e&1<<n)==0;n--);return this.high!=0?n+33:n+1};X.isSafeInteger=function(){var e=this.high>>21;return e?this.unsigned?!1:e===-1&&!(this.low===0&&this.high===-2097152):!0};X.isZero=function(){return this.high===0&&this.low===0};X.eqz=X.isZero;X.isNegative=function(){return!this.unsigned&&this.high<0};X.isPositive=function(){return this.unsigned||this.high>=0};X.isOdd=function(){return(this.low&1)===1};X.isEven=function(){return(this.low&1)===0};X.equals=function(e){return gt(e)||(e=Lt(e)),this.unsigned!==e.unsigned&&this.high>>>31===1&&e.high>>>31===1?!1:this.high===e.high&&this.low===e.low};X.eq=X.equals;X.notEquals=function(e){return!this.eq(e)};X.neq=X.notEquals;X.ne=X.notEquals;X.lessThan=function(e){return this.comp(e)<0};X.lt=X.lessThan;X.lessThanOrEqual=function(e){return this.comp(e)<=0};X.lte=X.lessThanOrEqual;X.le=X.lessThanOrEqual;X.greaterThan=function(e){return this.comp(e)>0};X.gt=X.greaterThan;X.greaterThanOrEqual=function(e){return this.comp(e)>=0};X.gte=X.greaterThanOrEqual;X.ge=X.greaterThanOrEqual;X.compare=function(e){if(gt(e)||(e=Lt(e)),this.eq(e))return 0;var n=this.isNegative(),t=e.isNegative();return n&&!t?-1:!n&&t?1:this.unsigned?e.high>>>0>this.high>>>0||e.high===this.high&&e.low>>>0>this.low>>>0?-1:1:this.sub(e).isNegative()?-1:1};X.comp=X.compare;X.negate=function(){return!this.unsigned&&this.eq(wt)?wt:this.not().add(Xr)};X.neg=X.negate;X.add=function(e){gt(e)||(e=Lt(e));var n=this.high>>>16,t=this.high&65535,o=this.low>>>16,i=this.low&65535,a=e.high>>>16,s=e.high&65535,u=e.low>>>16,l=e.low&65535,d=0,p=0,h=0,g=0;return g+=i+l,h+=g>>>16,g&=65535,h+=o+u,p+=h>>>16,h&=65535,p+=t+s,d+=p>>>16,p&=65535,d+=n+a,d&=65535,Ne(h<<16|g,d<<16|p,this.unsigned)};X.subtract=function(e){return gt(e)||(e=Lt(e)),this.add(e.neg())};X.sub=X.subtract;X.multiply=function(e){if(this.isZero())return this;if(gt(e)||(e=Lt(e)),kt){var n=kt.mul(this.low,this.high,e.low,e.high);return Ne(n,kt.get_high(),this.unsigned)}if(e.isZero())return this.unsigned?Jn:qt;if(this.eq(wt))return e.isOdd()?wt:qt;if(e.eq(wt))return this.isOdd()?wt:qt;if(this.isNegative())return e.isNegative()?this.neg().mul(e.neg()):this.neg().mul(e).neg();if(e.isNegative())return this.mul(e.neg()).neg();if(this.lt(Ef)&&e.lt(Ef))return Nt(this.toNumber()*e.toNumber(),this.unsigned);var t=this.high>>>16,o=this.high&65535,i=this.low>>>16,a=this.low&65535,s=e.high>>>16,u=e.high&65535,l=e.low>>>16,d=e.low&65535,p=0,h=0,g=0,b=0;return b+=a*d,g+=b>>>16,b&=65535,g+=i*d,h+=g>>>16,g&=65535,g+=a*l,h+=g>>>16,g&=65535,h+=o*d,p+=h>>>16,h&=65535,h+=i*l,p+=h>>>16,h&=65535,h+=a*u,p+=h>>>16,h&=65535,p+=t*d+o*l+i*u+a*s,p&=65535,Ne(g<<16|b,p<<16|h,this.unsigned)};X.mul=X.multiply;X.divide=function(e){if(gt(e)||(e=Lt(e)),e.isZero())throw Error("division by zero");if(kt){if(!this.unsigned&&this.high===-2147483648&&e.low===-1&&e.high===-1)return this;var n=(this.unsigned?kt.div_u:kt.div_s)(this.low,this.high,e.low,e.high);return Ne(n,kt.get_high(),this.unsigned)}if(this.isZero())return this.unsigned?Jn:qt;var t,o,i;if(this.unsigned){if(e.unsigned||(e=e.toUnsigned()),e.gt(this))return Jn;if(e.gt(this.shru(1)))return Df;i=Jn}else{if(this.eq(wt)){if(e.eq(Xr)||e.eq(Gs))return wt;if(e.eq(wt))return Xr;var a=this.shr(1);return t=a.div(e).shl(1),t.eq(qt)?e.isNegative()?Xr:Gs:(o=this.sub(e.mul(t)),i=t.add(o.div(e)),i)}else if(e.eq(wt))return this.unsigned?Jn:qt;if(this.isNegative())return e.isNegative()?this.neg().div(e.neg()):this.neg().div(e).neg();if(e.isNegative())return this.div(e.neg()).neg();i=qt}for(o=this;o.gte(e);){t=Math.max(1,Math.floor(o.toNumber()/e.toNumber()));for(var s=Math.ceil(Math.log(t)/Math.LN2),u=s<=48?1:wi(2,s-48),l=Nt(t),d=l.mul(e);d.isNegative()||d.gt(o);)t-=u,l=Nt(t,this.unsigned),d=l.mul(e);l.isZero()&&(l=Xr),i=i.add(l),o=o.sub(d)}return i};X.div=X.divide;X.modulo=function(e){if(gt(e)||(e=Lt(e)),kt){var n=(this.unsigned?kt.rem_u:kt.rem_s)(this.low,this.high,e.low,e.high);return Ne(n,kt.get_high(),this.unsigned)}return this.sub(this.div(e).mul(e))};X.mod=X.modulo;X.rem=X.modulo;X.not=function(){return Ne(~this.low,~this.high,this.unsigned)};X.countLeadingZeros=function(){return this.high?Math.clz32(this.high):Math.clz32(this.low)+32};X.clz=X.countLeadingZeros;X.countTrailingZeros=function(){return this.low?Sf(this.low):Sf(this.high)+32};X.ctz=X.countTrailingZeros;X.and=function(e){return gt(e)||(e=Lt(e)),Ne(this.low&e.low,this.high&e.high,this.unsigned)};X.or=function(e){return gt(e)||(e=Lt(e)),Ne(this.low|e.low,this.high|e.high,this.unsigned)};X.xor=function(e){return gt(e)||(e=Lt(e)),Ne(this.low^e.low,this.high^e.high,this.unsigned)};X.shiftLeft=function(e){return gt(e)&&(e=e.toInt()),(e&=63)===0?this:e<32?Ne(this.low<<e,this.high<<e|this.low>>>32-e,this.unsigned):Ne(0,this.low<<e-32,this.unsigned)};X.shl=X.shiftLeft;X.shiftRight=function(e){return gt(e)&&(e=e.toInt()),(e&=63)===0?this:e<32?Ne(this.low>>>e|this.high<<32-e,this.high>>e,this.unsigned):Ne(this.high>>e-32,this.high>=0?0:-1,this.unsigned)};X.shr=X.shiftRight;X.shiftRightUnsigned=function(e){return gt(e)&&(e=e.toInt()),(e&=63)===0?this:e<32?Ne(this.low>>>e|this.high<<32-e,this.high>>>e,this.unsigned):e===32?Ne(this.high,0,this.unsigned):Ne(this.high>>>e-32,0,this.unsigned)};X.shru=X.shiftRightUnsigned;X.shr_u=X.shiftRightUnsigned;X.rotateLeft=function(e){var n;return gt(e)&&(e=e.toInt()),(e&=63)===0?this:e===32?Ne(this.high,this.low,this.unsigned):e<32?(n=32-e,Ne(this.low<<e|this.high>>>n,this.high<<e|this.low>>>n,this.unsigned)):(e-=32,n=32-e,Ne(this.high<<e|this.low>>>n,this.low<<e|this.high>>>n,this.unsigned))};X.rotl=X.rotateLeft;X.rotateRight=function(e){var n;return gt(e)&&(e=e.toInt()),(e&=63)===0?this:e===32?Ne(this.high,this.low,this.unsigned):e<32?(n=32-e,Ne(this.high<<n|this.low>>>e,this.low<<n|this.high>>>e,this.unsigned)):(e-=32,n=32-e,Ne(this.low<<n|this.high>>>e,this.high<<n|this.low>>>e,this.unsigned))};X.rotr=X.rotateRight;X.toSigned=function(){return this.unsigned?Ne(this.low,this.high,!1):this};X.toUnsigned=function(){return this.unsigned?this:Ne(this.low,this.high,!0)};X.toBytes=function(e){return e?this.toBytesLE():this.toBytesBE()};X.toBytesLE=function(){var e=this.high,n=this.low;return[n&255,n>>>8&255,n>>>16&255,n>>>24,e&255,e>>>8&255,e>>>16&255,e>>>24]};X.toBytesBE=function(){var e=this.high,n=this.low;return[e>>>24,e>>>16&255,e>>>8&255,e&255,n>>>24,n>>>16&255,n>>>8&255,n&255]};He.fromBytes=function(e,n,t){return t?He.fromBytesLE(e,n):He.fromBytesBE(e,n)};He.fromBytesLE=function(e,n){return new He(e[0]|e[1]<<8|e[2]<<16|e[3]<<24,e[4]|e[5]<<8|e[6]<<16|e[7]<<24,n)};He.fromBytesBE=function(e,n){return new He(e[4]<<24|e[5]<<16|e[6]<<8|e[7],e[0]<<24|e[1]<<16|e[2]<<8|e[3],n)};typeof BigInt=="function"&&(He.fromBigInt=function(e,n){var t=Number(BigInt.asIntN(32,e)),o=Number(BigInt.asIntN(32,e>>BigInt(32)));return Ne(t,o,n)},He.fromValue=function(e,n){return typeof e=="bigint"?He.fromBigInt(e,n):Lt(e,n)},X.toBigInt=function(){var e=BigInt(this.low>>>0),n=BigInt(this.unsigned?this.high>>>0:this.high);return n<<BigInt(32)|e});cr=He});var Ws=ie(vi=>{"use strict";Object.defineProperty(vi,"__esModule",{value:!0});vi.ArgType=void 0;var Lf;(function(r){r[r.INPUT=0]="INPUT",r[r.OUTPUT=1]="OUTPUT"})(Lf||(vi.ArgType=Lf={}))});var xi=ie(rn=>{"use strict";Object.defineProperty(rn,"__esModule",{value:!0});rn.SIZE_PREFIX_LENGTH=rn.FILE_IDENTIFIER_LENGTH=rn.SIZEOF_INT=rn.SIZEOF_SHORT=void 0;rn.SIZEOF_SHORT=2;rn.SIZEOF_INT=4;rn.FILE_IDENTIFIER_LENGTH=4;rn.SIZE_PREFIX_LENGTH=4});var Hs=ie(Rt=>{"use strict";Object.defineProperty(Rt,"__esModule",{value:!0});Rt.isLittleEndian=Rt.float64=Rt.float32=Rt.int32=void 0;Rt.int32=new Int32Array(2);Rt.float32=new Float32Array(Rt.int32.buffer);Rt.float64=new Float64Array(Rt.int32.buffer);Rt.isLittleEndian=new Uint16Array(new Uint8Array([1,0]).buffer)[0]===1});var qs=ie(Ti=>{"use strict";Object.defineProperty(Ti,"__esModule",{value:!0});Ti.Encoding=void 0;var Rf;(function(r){r[r.UTF8_BYTES=1]="UTF8_BYTES",r[r.UTF16_STRING=2]="UTF16_STRING"})(Rf||(Ti.Encoding=Rf={}))});var Ks=ie(Ii=>{"use strict";Object.defineProperty(Ii,"__esModule",{value:!0});Ii.ByteBuffer=void 0;var on=xi(),b2=qs(),vt=Hs(),js=class r{constructor(e){this.bytes_=e,this.position_=0,this.text_decoder_=new TextDecoder}static allocate(e){return new r(new Uint8Array(e))}clear(){this.position_=0}bytes(){return this.bytes_}position(){return this.position_}setPosition(e){this.position_=e}capacity(){return this.bytes_.length}readInt8(e){return this.readUint8(e)<<24>>24}readUint8(e){return this.bytes_[e]}readInt16(e){return this.readUint16(e)<<16>>16}readUint16(e){return this.bytes_[e]|this.bytes_[e+1]<<8}readInt32(e){return this.bytes_[e]|this.bytes_[e+1]<<8|this.bytes_[e+2]<<16|this.bytes_[e+3]<<24}readUint32(e){return this.readInt32(e)>>>0}readInt64(e){return BigInt.asIntN(64,BigInt(this.readUint32(e))+(BigInt(this.readUint32(e+4))<<BigInt(32)))}readUint64(e){return BigInt.asUintN(64,BigInt(this.readUint32(e))+(BigInt(this.readUint32(e+4))<<BigInt(32)))}readFloat32(e){return vt.int32[0]=this.readInt32(e),vt.float32[0]}readFloat64(e){return vt.int32[vt.isLittleEndian?0:1]=this.readInt32(e),vt.int32[vt.isLittleEndian?1:0]=this.readInt32(e+4),vt.float64[0]}writeInt8(e,n){this.bytes_[e]=n}writeUint8(e,n){this.bytes_[e]=n}writeInt16(e,n){this.bytes_[e]=n,this.bytes_[e+1]=n>>8}writeUint16(e,n){this.bytes_[e]=n,this.bytes_[e+1]=n>>8}writeInt32(e,n){this.bytes_[e]=n,this.bytes_[e+1]=n>>8,this.bytes_[e+2]=n>>16,this.bytes_[e+3]=n>>24}writeUint32(e,n){this.bytes_[e]=n,this.bytes_[e+1]=n>>8,this.bytes_[e+2]=n>>16,this.bytes_[e+3]=n>>24}writeInt64(e,n){this.writeInt32(e,Number(BigInt.asIntN(32,n))),this.writeInt32(e+4,Number(BigInt.asIntN(32,n>>BigInt(32))))}writeUint64(e,n){this.writeUint32(e,Number(BigInt.asUintN(32,n))),this.writeUint32(e+4,Number(BigInt.asUintN(32,n>>BigInt(32))))}writeFloat32(e,n){vt.float32[0]=n,this.writeInt32(e,vt.int32[0])}writeFloat64(e,n){vt.float64[0]=n,this.writeInt32(e,vt.int32[vt.isLittleEndian?0:1]),this.writeInt32(e+4,vt.int32[vt.isLittleEndian?1:0])}getBufferIdentifier(){if(this.bytes_.length<this.position_+on.SIZEOF_INT+on.FILE_IDENTIFIER_LENGTH)throw new Error("FlatBuffers: ByteBuffer is too short to contain an identifier.");let e="";for(let n=0;n<on.FILE_IDENTIFIER_LENGTH;n++)e+=String.fromCharCode(this.readInt8(this.position_+on.SIZEOF_INT+n));return e}__offset(e,n){let t=e-this.readInt32(e);return n<this.readInt16(t)?this.readInt16(t+n):0}__union(e,n){return e.bb_pos=n+this.readInt32(n),e.bb=this,e}__string(e,n){e+=this.readInt32(e);let t=this.readInt32(e);e+=on.SIZEOF_INT;let o=this.bytes_.subarray(e,e+t);return n===b2.Encoding.UTF8_BYTES?o:this.text_decoder_.decode(o)}__union_with_string(e,n){return typeof e=="string"?this.__string(n):this.__union(e,n)}__indirect(e){return e+this.readInt32(e)}__vector(e){return e+this.readInt32(e)+on.SIZEOF_INT}__vector_len(e){return this.readInt32(e+this.readInt32(e))}__has_identifier(e){if(e.length!=on.FILE_IDENTIFIER_LENGTH)throw new Error("FlatBuffers: file identifier must be length "+on.FILE_IDENTIFIER_LENGTH);for(let n=0;n<on.FILE_IDENTIFIER_LENGTH;n++)if(e.charCodeAt(n)!=this.readInt8(this.position()+on.SIZEOF_INT+n))return!1;return!0}createScalarList(e,n){let t=[];for(let o=0;o<n;++o){let i=e(o);i!==null&&t.push(i)}return t}createObjList(e,n){let t=[];for(let o=0;o<n;++o){let i=e(o);i!==null&&t.push(i.unpack())}return t}};Ii.ByteBuffer=js});var Mf=ie(Si=>{"use strict";Object.defineProperty(Si,"__esModule",{value:!0});Si.Builder=void 0;var zf=Ks(),Ot=xi(),Xs=class r{constructor(e){this.minalign=1,this.vtable=null,this.vtable_in_use=0,this.isNested=!1,this.object_start=0,this.vtables=[],this.vector_num_elems=0,this.force_defaults=!1,this.string_maps=null,this.text_encoder=new TextEncoder;let n;e?n=e:n=1024,this.bb=zf.ByteBuffer.allocate(n),this.space=n}clear(){this.bb.clear(),this.space=this.bb.capacity(),this.minalign=1,this.vtable=null,this.vtable_in_use=0,this.isNested=!1,this.object_start=0,this.vtables=[],this.vector_num_elems=0,this.force_defaults=!1,this.string_maps=null}forceDefaults(e){this.force_defaults=e}dataBuffer(){return this.bb}asUint8Array(){return this.bb.bytes().subarray(this.bb.position(),this.bb.position()+this.offset())}prep(e,n){e>this.minalign&&(this.minalign=e);let t=~(this.bb.capacity()-this.space+n)+1&e-1;for(;this.space<t+e+n;){let o=this.bb.capacity();this.bb=r.growByteBuffer(this.bb),this.space+=this.bb.capacity()-o}this.pad(t)}pad(e){for(let n=0;n<e;n++)this.bb.writeInt8(--this.space,0)}writeInt8(e){this.bb.writeInt8(this.space-=1,e)}writeInt16(e){this.bb.writeInt16(this.space-=2,e)}writeInt32(e){this.bb.writeInt32(this.space-=4,e)}writeInt64(e){this.bb.writeInt64(this.space-=8,e)}writeFloat32(e){this.bb.writeFloat32(this.space-=4,e)}writeFloat64(e){this.bb.writeFloat64(this.space-=8,e)}addInt8(e){this.prep(1,0),this.writeInt8(e)}addInt16(e){this.prep(2,0),this.writeInt16(e)}addInt32(e){this.prep(4,0),this.writeInt32(e)}addInt64(e){this.prep(8,0),this.writeInt64(e)}addFloat32(e){this.prep(4,0),this.writeFloat32(e)}addFloat64(e){this.prep(8,0),this.writeFloat64(e)}addFieldInt8(e,n,t){(this.force_defaults||n!=t)&&(this.addInt8(n),this.slot(e))}addFieldInt16(e,n,t){(this.force_defaults||n!=t)&&(this.addInt16(n),this.slot(e))}addFieldInt32(e,n,t){(this.force_defaults||n!=t)&&(this.addInt32(n),this.slot(e))}addFieldInt64(e,n,t){(this.force_defaults||n!==t)&&(this.addInt64(n),this.slot(e))}addFieldFloat32(e,n,t){(this.force_defaults||n!=t)&&(this.addFloat32(n),this.slot(e))}addFieldFloat64(e,n,t){(this.force_defaults||n!=t)&&(this.addFloat64(n),this.slot(e))}addFieldOffset(e,n,t){(this.force_defaults||n!=t)&&(this.addOffset(n),this.slot(e))}addFieldStruct(e,n,t){n!=t&&(this.nested(n),this.slot(e))}nested(e){if(e!=this.offset())throw new TypeError("FlatBuffers: struct must be serialized inline.")}notNested(){if(this.isNested)throw new TypeError("FlatBuffers: object serialization must not be nested.")}slot(e){this.vtable!==null&&(this.vtable[e]=this.offset())}offset(){return this.bb.capacity()-this.space}static growByteBuffer(e){let n=e.capacity();if(n&3221225472)throw new Error("FlatBuffers: cannot grow buffer beyond 2 gigabytes.");let t=n<<1,o=zf.ByteBuffer.allocate(t);return o.setPosition(t-n),o.bytes().set(e.bytes(),t-n),o}addOffset(e){this.prep(Ot.SIZEOF_INT,0),this.writeInt32(this.offset()-e+Ot.SIZEOF_INT)}startObject(e){this.notNested(),this.vtable==null&&(this.vtable=[]),this.vtable_in_use=e;for(let n=0;n<e;n++)this.vtable[n]=0;this.isNested=!0,this.object_start=this.offset()}endObject(){if(this.vtable==null||!this.isNested)throw new Error("FlatBuffers: endObject called without startObject");this.addInt32(0);let e=this.offset(),n=this.vtable_in_use-1;for(;n>=0&&this.vtable[n]==0;n--);let t=n+1;for(;n>=0;n--)this.addInt16(this.vtable[n]!=0?e-this.vtable[n]:0);let o=2;this.addInt16(e-this.object_start);let i=(t+o)*Ot.SIZEOF_SHORT;this.addInt16(i);let a=0,s=this.space;e:for(n=0;n<this.vtables.length;n++){let u=this.bb.capacity()-this.vtables[n];if(i==this.bb.readInt16(u)){for(let l=Ot.SIZEOF_SHORT;l<i;l+=Ot.SIZEOF_SHORT)if(this.bb.readInt16(s+l)!=this.bb.readInt16(u+l))continue e;a=this.vtables[n];break}}return a?(this.space=this.bb.capacity()-e,this.bb.writeInt32(this.space,a-e)):(this.vtables.push(this.offset()),this.bb.writeInt32(this.bb.capacity()-e,this.offset()-e)),this.isNested=!1,e}finish(e,n,t){let o=t?Ot.SIZE_PREFIX_LENGTH:0;if(n){let i=n;if(this.prep(this.minalign,Ot.SIZEOF_INT+Ot.FILE_IDENTIFIER_LENGTH+o),i.length!=Ot.FILE_IDENTIFIER_LENGTH)throw new TypeError("FlatBuffers: file identifier must be length "+Ot.FILE_IDENTIFIER_LENGTH);for(let a=Ot.FILE_IDENTIFIER_LENGTH-1;a>=0;a--)this.writeInt8(i.charCodeAt(a))}this.prep(this.minalign,Ot.SIZEOF_INT+o),this.addOffset(e),o&&this.addInt32(this.bb.capacity()-this.space),this.bb.setPosition(this.space)}finishSizePrefixed(e,n){this.finish(e,n,!0)}requiredField(e,n){let t=this.bb.capacity()-e,o=t-this.bb.readInt32(t);if(!(n<this.bb.readInt16(o)&&this.bb.readInt16(o+n)!=0))throw new TypeError("FlatBuffers: field "+n+" must be set")}startVector(e,n,t){this.notNested(),this.vector_num_elems=n,this.prep(Ot.SIZEOF_INT,e*n),this.prep(t,e*n)}endVector(){return this.writeInt32(this.vector_num_elems),this.offset()}createSharedString(e){if(!e)return 0;if(this.string_maps||(this.string_maps=new Map),this.string_maps.has(e))return this.string_maps.get(e);let n=this.createString(e);return this.string_maps.set(e,n),n}createString(e){if(e==null)return 0;let n;return e instanceof Uint8Array?n=e:n=this.text_encoder.encode(e),this.addInt8(0),this.startVector(1,n.length,1),this.bb.setPosition(this.space-=n.length),this.bb.bytes().set(n,this.space),this.endVector()}createByteVector(e){return e==null?0:(this.startVector(1,e.length,1),this.bb.setPosition(this.space-=e.length),this.bb.bytes().set(e,this.space),this.endVector())}createObjectOffset(e){return e===null?0:typeof e=="string"?this.createString(e):e.pack(this)}createObjectOffsetList(e){let n=[];for(let t=0;t<e.length;++t){let o=e[t];if(o!==null)n.push(this.createObjectOffset(o));else throw new TypeError("FlatBuffers: Argument for createObjectOffsetList cannot contain null.")}return n}createStructOffsetList(e,n){return n(this,e.length),this.createObjectOffsetList(e.slice().reverse()),this.endVector()}};Si.Builder=Xs});var Me=ie(Ye=>{"use strict";Object.defineProperty(Ye,"__esModule",{value:!0});Ye.Encoding=Ye.ByteBuffer=Ye.Builder=Ye.isLittleEndian=Ye.int32=Ye.float64=Ye.float32=Ye.SIZE_PREFIX_LENGTH=Ye.SIZEOF_SHORT=Ye.SIZEOF_INT=Ye.FILE_IDENTIFIER_LENGTH=void 0;var $i=xi();Object.defineProperty(Ye,"FILE_IDENTIFIER_LENGTH",{enumerable:!0,get:function(){return $i.FILE_IDENTIFIER_LENGTH}});Object.defineProperty(Ye,"SIZEOF_INT",{enumerable:!0,get:function(){return $i.SIZEOF_INT}});Object.defineProperty(Ye,"SIZEOF_SHORT",{enumerable:!0,get:function(){return $i.SIZEOF_SHORT}});Object.defineProperty(Ye,"SIZE_PREFIX_LENGTH",{enumerable:!0,get:function(){return $i.SIZE_PREFIX_LENGTH}});var Ai=Hs();Object.defineProperty(Ye,"float32",{enumerable:!0,get:function(){return Ai.float32}});Object.defineProperty(Ye,"float64",{enumerable:!0,get:function(){return Ai.float64}});Object.defineProperty(Ye,"int32",{enumerable:!0,get:function(){return Ai.int32}});Object.defineProperty(Ye,"isLittleEndian",{enumerable:!0,get:function(){return Ai.isLittleEndian}});var y2=Mf();Object.defineProperty(Ye,"Builder",{enumerable:!0,get:function(){return y2.Builder}});var _2=Ks();Object.defineProperty(Ye,"ByteBuffer",{enumerable:!0,get:function(){return _2.ByteBuffer}});var w2=qs();Object.defineProperty(Ye,"Encoding",{enumerable:!0,get:function(){return w2.Encoding}})});var Js=ie(an=>{"use strict";var v2=an&&an.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),x2=an&&an.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),T2=an&&an.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&v2(n,e,t[o]);return x2(n,e),n}})();Object.defineProperty(an,"__esModule",{value:!0});an.ArgTypeAndIndex=void 0;var I2=T2(Me()),Bf=Ws(),Zs=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsArgTypeAndIndex(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsArgTypeAndIndex(e,n){return e.setPosition(e.position()+I2.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}argType(){let e=this.bb.__offset(this.bb_pos,4);return e?this.bb.readInt8(this.bb_pos+e):Bf.ArgType.INPUT}index(){let e=this.bb.__offset(this.bb_pos,6);return e?this.bb.readUint32(this.bb_pos+e):0}static startArgTypeAndIndex(e){e.startObject(2)}static addArgType(e,n){e.addFieldInt8(0,n,Bf.ArgType.INPUT)}static addIndex(e,n){e.addFieldInt32(1,n,0)}static endArgTypeAndIndex(e){return e.endObject()}static createArgTypeAndIndex(e,n,t){return r.startArgTypeAndIndex(e),r.addArgType(e,n),r.addIndex(e,t),r.endArgTypeAndIndex(e)}};an.ArgTypeAndIndex=Zs});var Ys=ie(Oi=>{"use strict";Object.defineProperty(Oi,"__esModule",{value:!0});Oi.AttributeType=void 0;var Vf;(function(r){r[r.UNDEFINED=0]="UNDEFINED",r[r.FLOAT=1]="FLOAT",r[r.INT=2]="INT",r[r.STRING=3]="STRING",r[r.TENSOR=4]="TENSOR",r[r.GRAPH=5]="GRAPH",r[r.FLOATS=6]="FLOATS",r[r.INTS=7]="INTS",r[r.STRINGS=8]="STRINGS",r[r.TENSORS=9]="TENSORS",r[r.GRAPHS=10]="GRAPHS",r[r.SPARSE_TENSOR=11]="SPARSE_TENSOR",r[r.SPARSE_TENSORS=12]="SPARSE_TENSORS"})(Vf||(Oi.AttributeType=Vf={}))});var Qs=ie(Pi=>{"use strict";Object.defineProperty(Pi,"__esModule",{value:!0});Pi.NodeType=void 0;var Gf;(function(r){r[r.Primitive=0]="Primitive",r[r.Fused=1]="Fused"})(Gf||(Pi.NodeType=Gf={}))});var tu=ie(sn=>{"use strict";var S2=sn&&sn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),$2=sn&&sn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),A2=sn&&sn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&S2(n,e,t[o]);return $2(n,e),n}})();Object.defineProperty(sn,"__esModule",{value:!0});sn.Node=void 0;var O2=A2(Me()),P2=nu(),Uf=Qs(),eu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsNode(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsNode(e,n){return e.setPosition(e.position()+O2.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}name(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.__string(this.bb_pos+n,e):null}docString(e){let n=this.bb.__offset(this.bb_pos,6);return n?this.bb.__string(this.bb_pos+n,e):null}domain(e){let n=this.bb.__offset(this.bb_pos,8);return n?this.bb.__string(this.bb_pos+n,e):null}sinceVersion(){let e=this.bb.__offset(this.bb_pos,10);return e?this.bb.readInt32(this.bb_pos+e):0}index(){let e=this.bb.__offset(this.bb_pos,12);return e?this.bb.readUint32(this.bb_pos+e):0}opType(e){let n=this.bb.__offset(this.bb_pos,14);return n?this.bb.__string(this.bb_pos+n,e):null}type(){let e=this.bb.__offset(this.bb_pos,16);return e?this.bb.readInt32(this.bb_pos+e):Uf.NodeType.Primitive}executionProviderType(e){let n=this.bb.__offset(this.bb_pos,18);return n?this.bb.__string(this.bb_pos+n,e):null}inputs(e,n){let t=this.bb.__offset(this.bb_pos,20);return t?this.bb.__string(this.bb.__vector(this.bb_pos+t)+e*4,n):null}inputsLength(){let e=this.bb.__offset(this.bb_pos,20);return e?this.bb.__vector_len(this.bb_pos+e):0}outputs(e,n){let t=this.bb.__offset(this.bb_pos,22);return t?this.bb.__string(this.bb.__vector(this.bb_pos+t)+e*4,n):null}outputsLength(){let e=this.bb.__offset(this.bb_pos,22);return e?this.bb.__vector_len(this.bb_pos+e):0}attributes(e,n){let t=this.bb.__offset(this.bb_pos,24);return t?(n||new P2.Attribute).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}attributesLength(){let e=this.bb.__offset(this.bb_pos,24);return e?this.bb.__vector_len(this.bb_pos+e):0}inputArgCounts(e){let n=this.bb.__offset(this.bb_pos,26);return n?this.bb.readInt32(this.bb.__vector(this.bb_pos+n)+e*4):0}inputArgCountsLength(){let e=this.bb.__offset(this.bb_pos,26);return e?this.bb.__vector_len(this.bb_pos+e):0}inputArgCountsArray(){let e=this.bb.__offset(this.bb_pos,26);return e?new Int32Array(this.bb.bytes().buffer,this.bb.bytes().byteOffset+this.bb.__vector(this.bb_pos+e),this.bb.__vector_len(this.bb_pos+e)):null}implicitInputs(e,n){let t=this.bb.__offset(this.bb_pos,28);return t?this.bb.__string(this.bb.__vector(this.bb_pos+t)+e*4,n):null}implicitInputsLength(){let e=this.bb.__offset(this.bb_pos,28);return e?this.bb.__vector_len(this.bb_pos+e):0}static startNode(e){e.startObject(13)}static addName(e,n){e.addFieldOffset(0,n,0)}static addDocString(e,n){e.addFieldOffset(1,n,0)}static addDomain(e,n){e.addFieldOffset(2,n,0)}static addSinceVersion(e,n){e.addFieldInt32(3,n,0)}static addIndex(e,n){e.addFieldInt32(4,n,0)}static addOpType(e,n){e.addFieldOffset(5,n,0)}static addType(e,n){e.addFieldInt32(6,n,Uf.NodeType.Primitive)}static addExecutionProviderType(e,n){e.addFieldOffset(7,n,0)}static addInputs(e,n){e.addFieldOffset(8,n,0)}static createInputsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startInputsVector(e,n){e.startVector(4,n,4)}static addOutputs(e,n){e.addFieldOffset(9,n,0)}static createOutputsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startOutputsVector(e,n){e.startVector(4,n,4)}static addAttributes(e,n){e.addFieldOffset(10,n,0)}static createAttributesVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startAttributesVector(e,n){e.startVector(4,n,4)}static addInputArgCounts(e,n){e.addFieldOffset(11,n,0)}static createInputArgCountsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addInt32(n[t]);return e.endVector()}static startInputArgCountsVector(e,n){e.startVector(4,n,4)}static addImplicitInputs(e,n){e.addFieldOffset(12,n,0)}static createImplicitInputsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startImplicitInputsVector(e,n){e.startVector(4,n,4)}static endNode(e){return e.endObject()}static createNode(e,n,t,o,i,a,s,u,l,d,p,h,g,b){return r.startNode(e),r.addName(e,n),r.addDocString(e,t),r.addDomain(e,o),r.addSinceVersion(e,i),r.addIndex(e,a),r.addOpType(e,s),r.addType(e,u),r.addExecutionProviderType(e,l),r.addInputs(e,d),r.addOutputs(e,p),r.addAttributes(e,h),r.addInputArgCounts(e,g),r.addImplicitInputs(e,b),r.endNode(e)}};sn.Node=eu});var ou=ie(Ei=>{"use strict";Object.defineProperty(Ei,"__esModule",{value:!0});Ei.EdgeEnd=void 0;var ru=class{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}nodeIndex(){return this.bb.readUint32(this.bb_pos)}srcArgIndex(){return this.bb.readInt32(this.bb_pos+4)}dstArgIndex(){return this.bb.readInt32(this.bb_pos+8)}static sizeOf(){return 12}static createEdgeEnd(e,n,t,o){return e.prep(4,12),e.writeInt32(o),e.writeInt32(t),e.writeInt32(n),e.offset()}};Ei.EdgeEnd=ru});var au=ie(un=>{"use strict";var E2=un&&un.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),C2=un&&un.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),D2=un&&un.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&E2(n,e,t[o]);return C2(n,e),n}})();Object.defineProperty(un,"__esModule",{value:!0});un.NodeEdge=void 0;var k2=D2(Me()),Ff=ou(),iu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsNodeEdge(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsNodeEdge(e,n){return e.setPosition(e.position()+k2.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}nodeIndex(){let e=this.bb.__offset(this.bb_pos,4);return e?this.bb.readUint32(this.bb_pos+e):0}inputEdges(e,n){let t=this.bb.__offset(this.bb_pos,6);return t?(n||new Ff.EdgeEnd).__init(this.bb.__vector(this.bb_pos+t)+e*12,this.bb):null}inputEdgesLength(){let e=this.bb.__offset(this.bb_pos,6);return e?this.bb.__vector_len(this.bb_pos+e):0}outputEdges(e,n){let t=this.bb.__offset(this.bb_pos,8);return t?(n||new Ff.EdgeEnd).__init(this.bb.__vector(this.bb_pos+t)+e*12,this.bb):null}outputEdgesLength(){let e=this.bb.__offset(this.bb_pos,8);return e?this.bb.__vector_len(this.bb_pos+e):0}static startNodeEdge(e){e.startObject(3)}static addNodeIndex(e,n){e.addFieldInt32(0,n,0)}static addInputEdges(e,n){e.addFieldOffset(1,n,0)}static startInputEdgesVector(e,n){e.startVector(12,n,4)}static addOutputEdges(e,n){e.addFieldOffset(2,n,0)}static startOutputEdgesVector(e,n){e.startVector(12,n,4)}static endNodeEdge(e){return e.endObject()}static createNodeEdge(e,n,t,o){return r.startNodeEdge(e),r.addNodeIndex(e,n),r.addInputEdges(e,t),r.addOutputEdges(e,o),r.endNodeEdge(e)}};un.NodeEdge=iu});var uu=ie(ln=>{"use strict";var N2=ln&&ln.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),L2=ln&&ln.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),R2=ln&&ln.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&N2(n,e,t[o]);return L2(n,e),n}})();Object.defineProperty(ln,"__esModule",{value:!0});ln.NodesToOptimizeIndices=void 0;var z2=R2(Me()),su=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsNodesToOptimizeIndices(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsNodesToOptimizeIndices(e,n){return e.setPosition(e.position()+z2.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}nodeIndices(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.readUint32(this.bb.__vector(this.bb_pos+n)+e*4):0}nodeIndicesLength(){let e=this.bb.__offset(this.bb_pos,4);return e?this.bb.__vector_len(this.bb_pos+e):0}nodeIndicesArray(){let e=this.bb.__offset(this.bb_pos,4);return e?new Uint32Array(this.bb.bytes().buffer,this.bb.bytes().byteOffset+this.bb.__vector(this.bb_pos+e),this.bb.__vector_len(this.bb_pos+e)):null}numInputs(){let e=this.bb.__offset(this.bb_pos,6);return e?this.bb.readUint32(this.bb_pos+e):0}numOutputs(){let e=this.bb.__offset(this.bb_pos,8);return e?this.bb.readUint32(this.bb_pos+e):0}hasVariadicInput(){let e=this.bb.__offset(this.bb_pos,10);return e?!!this.bb.readInt8(this.bb_pos+e):!1}hasVariadicOutput(){let e=this.bb.__offset(this.bb_pos,12);return e?!!this.bb.readInt8(this.bb_pos+e):!1}numVariadicInputs(){let e=this.bb.__offset(this.bb_pos,14);return e?this.bb.readUint32(this.bb_pos+e):0}numVariadicOutputs(){let e=this.bb.__offset(this.bb_pos,16);return e?this.bb.readUint32(this.bb_pos+e):0}static startNodesToOptimizeIndices(e){e.startObject(7)}static addNodeIndices(e,n){e.addFieldOffset(0,n,0)}static createNodeIndicesVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addInt32(n[t]);return e.endVector()}static startNodeIndicesVector(e,n){e.startVector(4,n,4)}static addNumInputs(e,n){e.addFieldInt32(1,n,0)}static addNumOutputs(e,n){e.addFieldInt32(2,n,0)}static addHasVariadicInput(e,n){e.addFieldInt8(3,+n,0)}static addHasVariadicOutput(e,n){e.addFieldInt8(4,+n,0)}static addNumVariadicInputs(e,n){e.addFieldInt32(5,n,0)}static addNumVariadicOutputs(e,n){e.addFieldInt32(6,n,0)}static endNodesToOptimizeIndices(e){return e.endObject()}static createNodesToOptimizeIndices(e,n,t,o,i,a,s,u){return r.startNodesToOptimizeIndices(e),r.addNodeIndices(e,n),r.addNumInputs(e,t),r.addNumOutputs(e,o),r.addHasVariadicInput(e,i),r.addHasVariadicOutput(e,a),r.addNumVariadicInputs(e,s),r.addNumVariadicOutputs(e,u),r.endNodesToOptimizeIndices(e)}};ln.NodesToOptimizeIndices=su});var cu=ie(cn=>{"use strict";var M2=cn&&cn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),B2=cn&&cn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),V2=cn&&cn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&M2(n,e,t[o]);return B2(n,e),n}})();Object.defineProperty(cn,"__esModule",{value:!0});cn.RuntimeOptimizationRecord=void 0;var G2=V2(Me()),U2=uu(),lu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsRuntimeOptimizationRecord(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsRuntimeOptimizationRecord(e,n){return e.setPosition(e.position()+G2.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}actionId(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.__string(this.bb_pos+n,e):null}nodesToOptimizeIndices(e){let n=this.bb.__offset(this.bb_pos,6);return n?(e||new U2.NodesToOptimizeIndices).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}producedOpIds(e,n){let t=this.bb.__offset(this.bb_pos,10);return t?this.bb.__string(this.bb.__vector(this.bb_pos+t)+e*4,n):null}producedOpIdsLength(){let e=this.bb.__offset(this.bb_pos,10);return e?this.bb.__vector_len(this.bb_pos+e):0}static startRuntimeOptimizationRecord(e){e.startObject(4)}static addActionId(e,n){e.addFieldOffset(0,n,0)}static addNodesToOptimizeIndices(e,n){e.addFieldOffset(1,n,0)}static addProducedOpIds(e,n){e.addFieldOffset(3,n,0)}static createProducedOpIdsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startProducedOpIdsVector(e,n){e.startVector(4,n,4)}static endRuntimeOptimizationRecord(e){return e.endObject()}};cn.RuntimeOptimizationRecord=lu});var pu=ie(dn=>{"use strict";var F2=dn&&dn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),W2=dn&&dn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),H2=dn&&dn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&F2(n,e,t[o]);return W2(n,e),n}})();Object.defineProperty(dn,"__esModule",{value:!0});dn.RuntimeOptimizationRecordContainerEntry=void 0;var q2=H2(Me()),j2=cu(),du=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsRuntimeOptimizationRecordContainerEntry(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsRuntimeOptimizationRecordContainerEntry(e,n){return e.setPosition(e.position()+q2.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}optimizerName(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.__string(this.bb_pos+n,e):null}runtimeOptimizationRecords(e,n){let t=this.bb.__offset(this.bb_pos,6);return t?(n||new j2.RuntimeOptimizationRecord).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}runtimeOptimizationRecordsLength(){let e=this.bb.__offset(this.bb_pos,6);return e?this.bb.__vector_len(this.bb_pos+e):0}static startRuntimeOptimizationRecordContainerEntry(e){e.startObject(2)}static addOptimizerName(e,n){e.addFieldOffset(0,n,0)}static addRuntimeOptimizationRecords(e,n){e.addFieldOffset(1,n,0)}static createRuntimeOptimizationRecordsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startRuntimeOptimizationRecordsVector(e,n){e.startVector(4,n,4)}static endRuntimeOptimizationRecordContainerEntry(e){let n=e.endObject();return e.requiredField(n,4),n}static createRuntimeOptimizationRecordContainerEntry(e,n,t){return r.startRuntimeOptimizationRecordContainerEntry(e),r.addOptimizerName(e,n),r.addRuntimeOptimizationRecords(e,t),r.endRuntimeOptimizationRecordContainerEntry(e)}};dn.RuntimeOptimizationRecordContainerEntry=du});var hu=ie(pn=>{"use strict";var K2=pn&&pn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),X2=pn&&pn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),Z2=pn&&pn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&K2(n,e,t[o]);return X2(n,e),n}})();Object.defineProperty(pn,"__esModule",{value:!0});pn.RuntimeOptimizations=void 0;var J2=Z2(Me()),Y2=pu(),fu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsRuntimeOptimizations(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsRuntimeOptimizations(e,n){return e.setPosition(e.position()+J2.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}records(e,n){let t=this.bb.__offset(this.bb_pos,4);return t?(n||new Y2.RuntimeOptimizationRecordContainerEntry).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}recordsLength(){let e=this.bb.__offset(this.bb_pos,4);return e?this.bb.__vector_len(this.bb_pos+e):0}static startRuntimeOptimizations(e){e.startObject(1)}static addRecords(e,n){e.addFieldOffset(0,n,0)}static createRecordsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startRecordsVector(e,n){e.startVector(4,n,4)}static endRuntimeOptimizations(e){return e.endObject()}static createRuntimeOptimizations(e,n){return r.startRuntimeOptimizations(e),r.addRecords(e,n),r.endRuntimeOptimizations(e)}};pn.RuntimeOptimizations=fu});var xo=ie(Ci=>{"use strict";Object.defineProperty(Ci,"__esModule",{value:!0});Ci.TensorDataType=void 0;var Wf;(function(r){r[r.UNDEFINED=0]="UNDEFINED",r[r.FLOAT=1]="FLOAT",r[r.UINT8=2]="UINT8",r[r.INT8=3]="INT8",r[r.UINT16=4]="UINT16",r[r.INT16=5]="INT16",r[r.INT32=6]="INT32",r[r.INT64=7]="INT64",r[r.STRING=8]="STRING",r[r.BOOL=9]="BOOL",r[r.FLOAT16=10]="FLOAT16",r[r.DOUBLE=11]="DOUBLE",r[r.UINT32=12]="UINT32",r[r.UINT64=13]="UINT64",r[r.COMPLEX64=14]="COMPLEX64",r[r.COMPLEX128=15]="COMPLEX128",r[r.BFLOAT16=16]="BFLOAT16",r[r.FLOAT8E4M3FN=17]="FLOAT8E4M3FN",r[r.FLOAT8E4M3FNUZ=18]="FLOAT8E4M3FNUZ",r[r.FLOAT8E5M2=19]="FLOAT8E5M2",r[r.FLOAT8E5M2FNUZ=20]="FLOAT8E5M2FNUZ"})(Wf||(Ci.TensorDataType=Wf={}))});var To=ie(fn=>{"use strict";var Q2=fn&&fn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),eI=fn&&fn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),tI=fn&&fn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&Q2(n,e,t[o]);return eI(n,e),n}})();Object.defineProperty(fn,"__esModule",{value:!0});fn.Tensor=void 0;var nI=tI(Me()),Hf=xo(),mu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsTensor(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsTensor(e,n){return e.setPosition(e.position()+nI.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}name(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.__string(this.bb_pos+n,e):null}docString(e){let n=this.bb.__offset(this.bb_pos,6);return n?this.bb.__string(this.bb_pos+n,e):null}dims(e){let n=this.bb.__offset(this.bb_pos,8);return n?this.bb.readInt64(this.bb.__vector(this.bb_pos+n)+e*8):BigInt(0)}dimsLength(){let e=this.bb.__offset(this.bb_pos,8);return e?this.bb.__vector_len(this.bb_pos+e):0}dataType(){let e=this.bb.__offset(this.bb_pos,10);return e?this.bb.readInt32(this.bb_pos+e):Hf.TensorDataType.UNDEFINED}rawData(e){let n=this.bb.__offset(this.bb_pos,12);return n?this.bb.readUint8(this.bb.__vector(this.bb_pos+n)+e):0}rawDataLength(){let e=this.bb.__offset(this.bb_pos,12);return e?this.bb.__vector_len(this.bb_pos+e):0}rawDataArray(){let e=this.bb.__offset(this.bb_pos,12);return e?new Uint8Array(this.bb.bytes().buffer,this.bb.bytes().byteOffset+this.bb.__vector(this.bb_pos+e),this.bb.__vector_len(this.bb_pos+e)):null}stringData(e,n){let t=this.bb.__offset(this.bb_pos,14);return t?this.bb.__string(this.bb.__vector(this.bb_pos+t)+e*4,n):null}stringDataLength(){let e=this.bb.__offset(this.bb_pos,14);return e?this.bb.__vector_len(this.bb_pos+e):0}externalDataOffset(){let e=this.bb.__offset(this.bb_pos,16);return e?this.bb.readInt64(this.bb_pos+e):BigInt("-1")}static startTensor(e){e.startObject(7)}static addName(e,n){e.addFieldOffset(0,n,0)}static addDocString(e,n){e.addFieldOffset(1,n,0)}static addDims(e,n){e.addFieldOffset(2,n,0)}static createDimsVector(e,n){e.startVector(8,n.length,8);for(let t=n.length-1;t>=0;t--)e.addInt64(n[t]);return e.endVector()}static startDimsVector(e,n){e.startVector(8,n,8)}static addDataType(e,n){e.addFieldInt32(3,n,Hf.TensorDataType.UNDEFINED)}static addRawData(e,n){e.addFieldOffset(4,n,0)}static createRawDataVector(e,n){e.startVector(1,n.length,1);for(let t=n.length-1;t>=0;t--)e.addInt8(n[t]);return e.endVector()}static startRawDataVector(e,n){e.startVector(1,n,1)}static addStringData(e,n){e.addFieldOffset(5,n,0)}static createStringDataVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startStringDataVector(e,n){e.startVector(4,n,4)}static addExternalDataOffset(e,n){e.addFieldInt64(6,n,BigInt("-1"))}static endTensor(e){return e.endObject()}static createTensor(e,n,t,o,i,a,s,u){return r.startTensor(e),r.addName(e,n),r.addDocString(e,t),r.addDims(e,o),r.addDataType(e,i),r.addRawData(e,a),r.addStringData(e,s),r.addExternalDataOffset(e,u),r.endTensor(e)}};fn.Tensor=mu});var bu=ie(hn=>{"use strict";var rI=hn&&hn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),oI=hn&&hn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),iI=hn&&hn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&rI(n,e,t[o]);return oI(n,e),n}})();Object.defineProperty(hn,"__esModule",{value:!0});hn.SparseTensor=void 0;var aI=iI(Me()),qf=To(),gu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsSparseTensor(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsSparseTensor(e,n){return e.setPosition(e.position()+aI.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}values(e){let n=this.bb.__offset(this.bb_pos,4);return n?(e||new qf.Tensor).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}indices(e){let n=this.bb.__offset(this.bb_pos,6);return n?(e||new qf.Tensor).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}dims(e){let n=this.bb.__offset(this.bb_pos,8);return n?this.bb.readInt64(this.bb.__vector(this.bb_pos+n)+e*8):BigInt(0)}dimsLength(){let e=this.bb.__offset(this.bb_pos,8);return e?this.bb.__vector_len(this.bb_pos+e):0}static startSparseTensor(e){e.startObject(3)}static addValues(e,n){e.addFieldOffset(0,n,0)}static addIndices(e,n){e.addFieldOffset(1,n,0)}static addDims(e,n){e.addFieldOffset(2,n,0)}static createDimsVector(e,n){e.startVector(8,n.length,8);for(let t=n.length-1;t>=0;t--)e.addInt64(n[t]);return e.endVector()}static startDimsVector(e,n){e.startVector(8,n,8)}static endSparseTensor(e){return e.endObject()}};hn.SparseTensor=gu});var _u=ie(mn=>{"use strict";var sI=mn&&mn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),uI=mn&&mn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),lI=mn&&mn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&sI(n,e,t[o]);return uI(n,e),n}})();Object.defineProperty(mn,"__esModule",{value:!0});mn.MapType=void 0;var cI=lI(Me()),jf=xo(),dI=Io(),yu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsMapType(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsMapType(e,n){return e.setPosition(e.position()+cI.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}keyType(){let e=this.bb.__offset(this.bb_pos,4);return e?this.bb.readInt32(this.bb_pos+e):jf.TensorDataType.UNDEFINED}valueType(e){let n=this.bb.__offset(this.bb_pos,6);return n?(e||new dI.TypeInfo).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}static startMapType(e){e.startObject(2)}static addKeyType(e,n){e.addFieldInt32(0,n,jf.TensorDataType.UNDEFINED)}static addValueType(e,n){e.addFieldOffset(1,n,0)}static endMapType(e){return e.endObject()}};mn.MapType=yu});var vu=ie(gn=>{"use strict";var pI=gn&&gn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),fI=gn&&gn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),hI=gn&&gn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&pI(n,e,t[o]);return fI(n,e),n}})();Object.defineProperty(gn,"__esModule",{value:!0});gn.SequenceType=void 0;var mI=hI(Me()),gI=Io(),wu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsSequenceType(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsSequenceType(e,n){return e.setPosition(e.position()+mI.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}elemType(e){let n=this.bb.__offset(this.bb_pos,4);return n?(e||new gI.TypeInfo).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}static startSequenceType(e){e.startObject(1)}static addElemType(e,n){e.addFieldOffset(0,n,0)}static endSequenceType(e){return e.endObject()}static createSequenceType(e,n){return r.startSequenceType(e),r.addElemType(e,n),r.endSequenceType(e)}};gn.SequenceType=wu});var xu=ie(Di=>{"use strict";Object.defineProperty(Di,"__esModule",{value:!0});Di.DimensionValueType=void 0;var Kf;(function(r){r[r.UNKNOWN=0]="UNKNOWN",r[r.VALUE=1]="VALUE",r[r.PARAM=2]="PARAM"})(Kf||(Di.DimensionValueType=Kf={}))});var Iu=ie(bn=>{"use strict";var bI=bn&&bn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),yI=bn&&bn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),_I=bn&&bn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&bI(n,e,t[o]);return yI(n,e),n}})();Object.defineProperty(bn,"__esModule",{value:!0});bn.DimensionValue=void 0;var wI=_I(Me()),Xf=xu(),Tu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsDimensionValue(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsDimensionValue(e,n){return e.setPosition(e.position()+wI.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}dimType(){let e=this.bb.__offset(this.bb_pos,4);return e?this.bb.readInt8(this.bb_pos+e):Xf.DimensionValueType.UNKNOWN}dimValue(){let e=this.bb.__offset(this.bb_pos,6);return e?this.bb.readInt64(this.bb_pos+e):BigInt("0")}dimParam(e){let n=this.bb.__offset(this.bb_pos,8);return n?this.bb.__string(this.bb_pos+n,e):null}static startDimensionValue(e){e.startObject(3)}static addDimType(e,n){e.addFieldInt8(0,n,Xf.DimensionValueType.UNKNOWN)}static addDimValue(e,n){e.addFieldInt64(1,n,BigInt("0"))}static addDimParam(e,n){e.addFieldOffset(2,n,0)}static endDimensionValue(e){return e.endObject()}static createDimensionValue(e,n,t,o){return r.startDimensionValue(e),r.addDimType(e,n),r.addDimValue(e,t),r.addDimParam(e,o),r.endDimensionValue(e)}};bn.DimensionValue=Tu});var $u=ie(yn=>{"use strict";var vI=yn&&yn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),xI=yn&&yn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),TI=yn&&yn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&vI(n,e,t[o]);return xI(n,e),n}})();Object.defineProperty(yn,"__esModule",{value:!0});yn.Dimension=void 0;var II=TI(Me()),SI=Iu(),Su=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsDimension(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsDimension(e,n){return e.setPosition(e.position()+II.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}value(e){let n=this.bb.__offset(this.bb_pos,4);return n?(e||new SI.DimensionValue).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}denotation(e){let n=this.bb.__offset(this.bb_pos,6);return n?this.bb.__string(this.bb_pos+n,e):null}static startDimension(e){e.startObject(2)}static addValue(e,n){e.addFieldOffset(0,n,0)}static addDenotation(e,n){e.addFieldOffset(1,n,0)}static endDimension(e){return e.endObject()}static createDimension(e,n,t){return r.startDimension(e),r.addValue(e,n),r.addDenotation(e,t),r.endDimension(e)}};yn.Dimension=Su});var Ou=ie(_n=>{"use strict";var $I=_n&&_n.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),AI=_n&&_n.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),OI=_n&&_n.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&$I(n,e,t[o]);return AI(n,e),n}})();Object.defineProperty(_n,"__esModule",{value:!0});_n.Shape=void 0;var PI=OI(Me()),EI=$u(),Au=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsShape(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsShape(e,n){return e.setPosition(e.position()+PI.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}dim(e,n){let t=this.bb.__offset(this.bb_pos,4);return t?(n||new EI.Dimension).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}dimLength(){let e=this.bb.__offset(this.bb_pos,4);return e?this.bb.__vector_len(this.bb_pos+e):0}static startShape(e){e.startObject(1)}static addDim(e,n){e.addFieldOffset(0,n,0)}static createDimVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startDimVector(e,n){e.startVector(4,n,4)}static endShape(e){return e.endObject()}static createShape(e,n){return r.startShape(e),r.addDim(e,n),r.endShape(e)}};_n.Shape=Au});var Eu=ie(wn=>{"use strict";var CI=wn&&wn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),DI=wn&&wn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),kI=wn&&wn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&CI(n,e,t[o]);return DI(n,e),n}})();Object.defineProperty(wn,"__esModule",{value:!0});wn.TensorTypeAndShape=void 0;var NI=kI(Me()),LI=Ou(),Zf=xo(),Pu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsTensorTypeAndShape(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsTensorTypeAndShape(e,n){return e.setPosition(e.position()+NI.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}elemType(){let e=this.bb.__offset(this.bb_pos,4);return e?this.bb.readInt32(this.bb_pos+e):Zf.TensorDataType.UNDEFINED}shape(e){let n=this.bb.__offset(this.bb_pos,6);return n?(e||new LI.Shape).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}static startTensorTypeAndShape(e){e.startObject(2)}static addElemType(e,n){e.addFieldInt32(0,n,Zf.TensorDataType.UNDEFINED)}static addShape(e,n){e.addFieldOffset(1,n,0)}static endTensorTypeAndShape(e){return e.endObject()}};wn.TensorTypeAndShape=Pu});var Cu=ie(Jr=>{"use strict";Object.defineProperty(Jr,"__esModule",{value:!0});Jr.TypeInfoValue=void 0;Jr.unionToTypeInfoValue=RI;Jr.unionListToTypeInfoValue=zI;var Jf=_u(),Yf=vu(),Qf=Eu(),ki;(function(r){r[r.NONE=0]="NONE",r[r.tensor_type=1]="tensor_type",r[r.sequence_type=2]="sequence_type",r[r.map_type=3]="map_type"})(ki||(Jr.TypeInfoValue=ki={}));function RI(r,e){switch(ki[r]){case"NONE":return null;case"tensor_type":return e(new Qf.TensorTypeAndShape);case"sequence_type":return e(new Yf.SequenceType);case"map_type":return e(new Jf.MapType);default:return null}}function zI(r,e,n){switch(ki[r]){case"NONE":return null;case"tensor_type":return e(n,new Qf.TensorTypeAndShape);case"sequence_type":return e(n,new Yf.SequenceType);case"map_type":return e(n,new Jf.MapType);default:return null}}});var Io=ie(vn=>{"use strict";var MI=vn&&vn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),BI=vn&&vn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),VI=vn&&vn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&MI(n,e,t[o]);return BI(n,e),n}})();Object.defineProperty(vn,"__esModule",{value:!0});vn.TypeInfo=void 0;var GI=VI(Me()),eh=Cu(),Du=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsTypeInfo(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsTypeInfo(e,n){return e.setPosition(e.position()+GI.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}denotation(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.__string(this.bb_pos+n,e):null}valueType(){let e=this.bb.__offset(this.bb_pos,6);return e?this.bb.readUint8(this.bb_pos+e):eh.TypeInfoValue.NONE}value(e){let n=this.bb.__offset(this.bb_pos,8);return n?this.bb.__union(e,this.bb_pos+n):null}static startTypeInfo(e){e.startObject(3)}static addDenotation(e,n){e.addFieldOffset(0,n,0)}static addValueType(e,n){e.addFieldInt8(1,n,eh.TypeInfoValue.NONE)}static addValue(e,n){e.addFieldOffset(2,n,0)}static endTypeInfo(e){return e.endObject()}static createTypeInfo(e,n,t,o){return r.startTypeInfo(e),r.addDenotation(e,n),r.addValueType(e,t),r.addValue(e,o),r.endTypeInfo(e)}};vn.TypeInfo=Du});var Nu=ie(xn=>{"use strict";var UI=xn&&xn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),FI=xn&&xn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),WI=xn&&xn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&UI(n,e,t[o]);return FI(n,e),n}})();Object.defineProperty(xn,"__esModule",{value:!0});xn.ValueInfo=void 0;var HI=WI(Me()),qI=Io(),ku=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsValueInfo(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsValueInfo(e,n){return e.setPosition(e.position()+HI.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}name(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.__string(this.bb_pos+n,e):null}docString(e){let n=this.bb.__offset(this.bb_pos,6);return n?this.bb.__string(this.bb_pos+n,e):null}type(e){let n=this.bb.__offset(this.bb_pos,8);return n?(e||new qI.TypeInfo).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}static startValueInfo(e){e.startObject(3)}static addName(e,n){e.addFieldOffset(0,n,0)}static addDocString(e,n){e.addFieldOffset(1,n,0)}static addType(e,n){e.addFieldOffset(2,n,0)}static endValueInfo(e){return e.endObject()}};xn.ValueInfo=ku});var Ni=ie(Tn=>{"use strict";var jI=Tn&&Tn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),KI=Tn&&Tn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),XI=Tn&&Tn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&jI(n,e,t[o]);return KI(n,e),n}})();Object.defineProperty(Tn,"__esModule",{value:!0});Tn.Graph=void 0;var ZI=XI(Me()),JI=tu(),YI=au(),QI=hu(),eS=bu(),tS=To(),nS=Nu(),Lu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsGraph(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsGraph(e,n){return e.setPosition(e.position()+ZI.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}initializers(e,n){let t=this.bb.__offset(this.bb_pos,4);return t?(n||new tS.Tensor).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}initializersLength(){let e=this.bb.__offset(this.bb_pos,4);return e?this.bb.__vector_len(this.bb_pos+e):0}nodeArgs(e,n){let t=this.bb.__offset(this.bb_pos,6);return t?(n||new nS.ValueInfo).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}nodeArgsLength(){let e=this.bb.__offset(this.bb_pos,6);return e?this.bb.__vector_len(this.bb_pos+e):0}nodes(e,n){let t=this.bb.__offset(this.bb_pos,8);return t?(n||new JI.Node).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}nodesLength(){let e=this.bb.__offset(this.bb_pos,8);return e?this.bb.__vector_len(this.bb_pos+e):0}maxNodeIndex(){let e=this.bb.__offset(this.bb_pos,10);return e?this.bb.readUint32(this.bb_pos+e):0}nodeEdges(e,n){let t=this.bb.__offset(this.bb_pos,12);return t?(n||new YI.NodeEdge).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}nodeEdgesLength(){let e=this.bb.__offset(this.bb_pos,12);return e?this.bb.__vector_len(this.bb_pos+e):0}inputs(e,n){let t=this.bb.__offset(this.bb_pos,14);return t?this.bb.__string(this.bb.__vector(this.bb_pos+t)+e*4,n):null}inputsLength(){let e=this.bb.__offset(this.bb_pos,14);return e?this.bb.__vector_len(this.bb_pos+e):0}outputs(e,n){let t=this.bb.__offset(this.bb_pos,16);return t?this.bb.__string(this.bb.__vector(this.bb_pos+t)+e*4,n):null}outputsLength(){let e=this.bb.__offset(this.bb_pos,16);return e?this.bb.__vector_len(this.bb_pos+e):0}sparseInitializers(e,n){let t=this.bb.__offset(this.bb_pos,18);return t?(n||new eS.SparseTensor).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}sparseInitializersLength(){let e=this.bb.__offset(this.bb_pos,18);return e?this.bb.__vector_len(this.bb_pos+e):0}runtimeOptimizations(e){let n=this.bb.__offset(this.bb_pos,20);return n?(e||new QI.RuntimeOptimizations).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}static startGraph(e){e.startObject(9)}static addInitializers(e,n){e.addFieldOffset(0,n,0)}static createInitializersVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startInitializersVector(e,n){e.startVector(4,n,4)}static addNodeArgs(e,n){e.addFieldOffset(1,n,0)}static createNodeArgsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startNodeArgsVector(e,n){e.startVector(4,n,4)}static addNodes(e,n){e.addFieldOffset(2,n,0)}static createNodesVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startNodesVector(e,n){e.startVector(4,n,4)}static addMaxNodeIndex(e,n){e.addFieldInt32(3,n,0)}static addNodeEdges(e,n){e.addFieldOffset(4,n,0)}static createNodeEdgesVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startNodeEdgesVector(e,n){e.startVector(4,n,4)}static addInputs(e,n){e.addFieldOffset(5,n,0)}static createInputsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startInputsVector(e,n){e.startVector(4,n,4)}static addOutputs(e,n){e.addFieldOffset(6,n,0)}static createOutputsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startOutputsVector(e,n){e.startVector(4,n,4)}static addSparseInitializers(e,n){e.addFieldOffset(7,n,0)}static createSparseInitializersVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startSparseInitializersVector(e,n){e.startVector(4,n,4)}static addRuntimeOptimizations(e,n){e.addFieldOffset(8,n,0)}static endGraph(e){return e.endObject()}};Tn.Graph=Lu});var nu=ie(In=>{"use strict";var rS=In&&In.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),oS=In&&In.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),iS=In&&In.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&rS(n,e,t[o]);return oS(n,e),n}})();Object.defineProperty(In,"__esModule",{value:!0});In.Attribute=void 0;var aS=iS(Me()),th=Ys(),nh=Ni(),rh=To(),Ru=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsAttribute(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsAttribute(e,n){return e.setPosition(e.position()+aS.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}name(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.__string(this.bb_pos+n,e):null}docString(e){let n=this.bb.__offset(this.bb_pos,6);return n?this.bb.__string(this.bb_pos+n,e):null}type(){let e=this.bb.__offset(this.bb_pos,8);return e?this.bb.readInt32(this.bb_pos+e):th.AttributeType.UNDEFINED}f(){let e=this.bb.__offset(this.bb_pos,10);return e?this.bb.readFloat32(this.bb_pos+e):0}i(){let e=this.bb.__offset(this.bb_pos,12);return e?this.bb.readInt64(this.bb_pos+e):BigInt("0")}s(e){let n=this.bb.__offset(this.bb_pos,14);return n?this.bb.__string(this.bb_pos+n,e):null}t(e){let n=this.bb.__offset(this.bb_pos,16);return n?(e||new rh.Tensor).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}g(e){let n=this.bb.__offset(this.bb_pos,18);return n?(e||new nh.Graph).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}floats(e){let n=this.bb.__offset(this.bb_pos,20);return n?this.bb.readFloat32(this.bb.__vector(this.bb_pos+n)+e*4):0}floatsLength(){let e=this.bb.__offset(this.bb_pos,20);return e?this.bb.__vector_len(this.bb_pos+e):0}floatsArray(){let e=this.bb.__offset(this.bb_pos,20);return e?new Float32Array(this.bb.bytes().buffer,this.bb.bytes().byteOffset+this.bb.__vector(this.bb_pos+e),this.bb.__vector_len(this.bb_pos+e)):null}ints(e){let n=this.bb.__offset(this.bb_pos,22);return n?this.bb.readInt64(this.bb.__vector(this.bb_pos+n)+e*8):BigInt(0)}intsLength(){let e=this.bb.__offset(this.bb_pos,22);return e?this.bb.__vector_len(this.bb_pos+e):0}strings(e,n){let t=this.bb.__offset(this.bb_pos,24);return t?this.bb.__string(this.bb.__vector(this.bb_pos+t)+e*4,n):null}stringsLength(){let e=this.bb.__offset(this.bb_pos,24);return e?this.bb.__vector_len(this.bb_pos+e):0}tensors(e,n){let t=this.bb.__offset(this.bb_pos,26);return t?(n||new rh.Tensor).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}tensorsLength(){let e=this.bb.__offset(this.bb_pos,26);return e?this.bb.__vector_len(this.bb_pos+e):0}graphs(e,n){let t=this.bb.__offset(this.bb_pos,28);return t?(n||new nh.Graph).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}graphsLength(){let e=this.bb.__offset(this.bb_pos,28);return e?this.bb.__vector_len(this.bb_pos+e):0}static startAttribute(e){e.startObject(13)}static addName(e,n){e.addFieldOffset(0,n,0)}static addDocString(e,n){e.addFieldOffset(1,n,0)}static addType(e,n){e.addFieldInt32(2,n,th.AttributeType.UNDEFINED)}static addF(e,n){e.addFieldFloat32(3,n,0)}static addI(e,n){e.addFieldInt64(4,n,BigInt("0"))}static addS(e,n){e.addFieldOffset(5,n,0)}static addT(e,n){e.addFieldOffset(6,n,0)}static addG(e,n){e.addFieldOffset(7,n,0)}static addFloats(e,n){e.addFieldOffset(8,n,0)}static createFloatsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addFloat32(n[t]);return e.endVector()}static startFloatsVector(e,n){e.startVector(4,n,4)}static addInts(e,n){e.addFieldOffset(9,n,0)}static createIntsVector(e,n){e.startVector(8,n.length,8);for(let t=n.length-1;t>=0;t--)e.addInt64(n[t]);return e.endVector()}static startIntsVector(e,n){e.startVector(8,n,8)}static addStrings(e,n){e.addFieldOffset(10,n,0)}static createStringsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startStringsVector(e,n){e.startVector(4,n,4)}static addTensors(e,n){e.addFieldOffset(11,n,0)}static createTensorsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startTensorsVector(e,n){e.startVector(4,n,4)}static addGraphs(e,n){e.addFieldOffset(12,n,0)}static createGraphsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startGraphsVector(e,n){e.startVector(4,n,4)}static endAttribute(e){return e.endObject()}};In.Attribute=Ru});var Mu=ie(Sn=>{"use strict";var sS=Sn&&Sn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),uS=Sn&&Sn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),lS=Sn&&Sn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&sS(n,e,t[o]);return uS(n,e),n}})();Object.defineProperty(Sn,"__esModule",{value:!0});Sn.DeprecatedKernelCreateInfos=void 0;var cS=lS(Me()),zu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsDeprecatedKernelCreateInfos(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsDeprecatedKernelCreateInfos(e,n){return e.setPosition(e.position()+cS.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}nodeIndices(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.readUint32(this.bb.__vector(this.bb_pos+n)+e*4):0}nodeIndicesLength(){let e=this.bb.__offset(this.bb_pos,4);return e?this.bb.__vector_len(this.bb_pos+e):0}nodeIndicesArray(){let e=this.bb.__offset(this.bb_pos,4);return e?new Uint32Array(this.bb.bytes().buffer,this.bb.bytes().byteOffset+this.bb.__vector(this.bb_pos+e),this.bb.__vector_len(this.bb_pos+e)):null}kernelDefHashes(e){let n=this.bb.__offset(this.bb_pos,6);return n?this.bb.readUint64(this.bb.__vector(this.bb_pos+n)+e*8):BigInt(0)}kernelDefHashesLength(){let e=this.bb.__offset(this.bb_pos,6);return e?this.bb.__vector_len(this.bb_pos+e):0}static startDeprecatedKernelCreateInfos(e){e.startObject(2)}static addNodeIndices(e,n){e.addFieldOffset(0,n,0)}static createNodeIndicesVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addInt32(n[t]);return e.endVector()}static startNodeIndicesVector(e,n){e.startVector(4,n,4)}static addKernelDefHashes(e,n){e.addFieldOffset(1,n,0)}static createKernelDefHashesVector(e,n){e.startVector(8,n.length,8);for(let t=n.length-1;t>=0;t--)e.addInt64(n[t]);return e.endVector()}static startKernelDefHashesVector(e,n){e.startVector(8,n,8)}static endDeprecatedKernelCreateInfos(e){return e.endObject()}static createDeprecatedKernelCreateInfos(e,n,t){return r.startDeprecatedKernelCreateInfos(e),r.addNodeIndices(e,n),r.addKernelDefHashes(e,t),r.endDeprecatedKernelCreateInfos(e)}};Sn.DeprecatedKernelCreateInfos=zu});var oh=ie($n=>{"use strict";var dS=$n&&$n.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),pS=$n&&$n.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),fS=$n&&$n.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&dS(n,e,t[o]);return pS(n,e),n}})();Object.defineProperty($n,"__esModule",{value:!0});$n.DeprecatedNodeIndexAndKernelDefHash=void 0;var hS=fS(Me()),Bu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsDeprecatedNodeIndexAndKernelDefHash(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsDeprecatedNodeIndexAndKernelDefHash(e,n){return e.setPosition(e.position()+hS.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}nodeIndex(){let e=this.bb.__offset(this.bb_pos,4);return e?this.bb.readUint32(this.bb_pos+e):0}kernelDefHash(){let e=this.bb.__offset(this.bb_pos,6);return e?this.bb.readUint64(this.bb_pos+e):BigInt("0")}static startDeprecatedNodeIndexAndKernelDefHash(e){e.startObject(2)}static addNodeIndex(e,n){e.addFieldInt32(0,n,0)}static addKernelDefHash(e,n){e.addFieldInt64(1,n,BigInt("0"))}static endDeprecatedNodeIndexAndKernelDefHash(e){return e.endObject()}static createDeprecatedNodeIndexAndKernelDefHash(e,n,t){return r.startDeprecatedNodeIndexAndKernelDefHash(e),r.addNodeIndex(e,n),r.addKernelDefHash(e,t),r.endDeprecatedNodeIndexAndKernelDefHash(e)}};$n.DeprecatedNodeIndexAndKernelDefHash=Bu});var Gu=ie(An=>{"use strict";var mS=An&&An.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),gS=An&&An.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),bS=An&&An.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&mS(n,e,t[o]);return gS(n,e),n}})();Object.defineProperty(An,"__esModule",{value:!0});An.DeprecatedSubGraphSessionState=void 0;var yS=bS(Me()),_S=Uu(),Vu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsDeprecatedSubGraphSessionState(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsDeprecatedSubGraphSessionState(e,n){return e.setPosition(e.position()+yS.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}graphId(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.__string(this.bb_pos+n,e):null}sessionState(e){let n=this.bb.__offset(this.bb_pos,6);return n?(e||new _S.DeprecatedSessionState).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}static startDeprecatedSubGraphSessionState(e){e.startObject(2)}static addGraphId(e,n){e.addFieldOffset(0,n,0)}static addSessionState(e,n){e.addFieldOffset(1,n,0)}static endDeprecatedSubGraphSessionState(e){let n=e.endObject();return e.requiredField(n,4),n}};An.DeprecatedSubGraphSessionState=Vu});var Uu=ie(On=>{"use strict";var wS=On&&On.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),vS=On&&On.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),xS=On&&On.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&wS(n,e,t[o]);return vS(n,e),n}})();Object.defineProperty(On,"__esModule",{value:!0});On.DeprecatedSessionState=void 0;var TS=xS(Me()),IS=Mu(),SS=Gu(),Fu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsDeprecatedSessionState(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsDeprecatedSessionState(e,n){return e.setPosition(e.position()+TS.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}kernels(e){let n=this.bb.__offset(this.bb_pos,4);return n?(e||new IS.DeprecatedKernelCreateInfos).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}subGraphSessionStates(e,n){let t=this.bb.__offset(this.bb_pos,6);return t?(n||new SS.DeprecatedSubGraphSessionState).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}subGraphSessionStatesLength(){let e=this.bb.__offset(this.bb_pos,6);return e?this.bb.__vector_len(this.bb_pos+e):0}static startDeprecatedSessionState(e){e.startObject(2)}static addKernels(e,n){e.addFieldOffset(0,n,0)}static addSubGraphSessionStates(e,n){e.addFieldOffset(1,n,0)}static createSubGraphSessionStatesVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startSubGraphSessionStatesVector(e,n){e.startVector(4,n,4)}static endDeprecatedSessionState(e){return e.endObject()}static createDeprecatedSessionState(e,n,t){return r.startDeprecatedSessionState(e),r.addKernels(e,n),r.addSubGraphSessionStates(e,t),r.endDeprecatedSessionState(e)}};On.DeprecatedSessionState=Fu});var Hu=ie(Pn=>{"use strict";var $S=Pn&&Pn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),AS=Pn&&Pn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),OS=Pn&&Pn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&$S(n,e,t[o]);return AS(n,e),n}})();Object.defineProperty(Pn,"__esModule",{value:!0});Pn.KernelTypeStrArgsEntry=void 0;var PS=OS(Me()),ES=Js(),Wu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsKernelTypeStrArgsEntry(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsKernelTypeStrArgsEntry(e,n){return e.setPosition(e.position()+PS.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}kernelTypeStr(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.__string(this.bb_pos+n,e):null}args(e,n){let t=this.bb.__offset(this.bb_pos,6);return t?(n||new ES.ArgTypeAndIndex).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}argsLength(){let e=this.bb.__offset(this.bb_pos,6);return e?this.bb.__vector_len(this.bb_pos+e):0}static startKernelTypeStrArgsEntry(e){e.startObject(2)}static addKernelTypeStr(e,n){e.addFieldOffset(0,n,0)}static addArgs(e,n){e.addFieldOffset(1,n,0)}static createArgsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startArgsVector(e,n){e.startVector(4,n,4)}static endKernelTypeStrArgsEntry(e){let n=e.endObject();return e.requiredField(n,4),n}static createKernelTypeStrArgsEntry(e,n,t){return r.startKernelTypeStrArgsEntry(e),r.addKernelTypeStr(e,n),r.addArgs(e,t),r.endKernelTypeStrArgsEntry(e)}};Pn.KernelTypeStrArgsEntry=Wu});var ju=ie(En=>{"use strict";var CS=En&&En.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),DS=En&&En.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),kS=En&&En.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&CS(n,e,t[o]);return DS(n,e),n}})();Object.defineProperty(En,"__esModule",{value:!0});En.OpIdKernelTypeStrArgsEntry=void 0;var NS=kS(Me()),LS=Hu(),qu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsOpIdKernelTypeStrArgsEntry(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsOpIdKernelTypeStrArgsEntry(e,n){return e.setPosition(e.position()+NS.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}opId(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.__string(this.bb_pos+n,e):null}kernelTypeStrArgs(e,n){let t=this.bb.__offset(this.bb_pos,6);return t?(n||new LS.KernelTypeStrArgsEntry).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}kernelTypeStrArgsLength(){let e=this.bb.__offset(this.bb_pos,6);return e?this.bb.__vector_len(this.bb_pos+e):0}static startOpIdKernelTypeStrArgsEntry(e){e.startObject(2)}static addOpId(e,n){e.addFieldOffset(0,n,0)}static addKernelTypeStrArgs(e,n){e.addFieldOffset(1,n,0)}static createKernelTypeStrArgsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startKernelTypeStrArgsVector(e,n){e.startVector(4,n,4)}static endOpIdKernelTypeStrArgsEntry(e){let n=e.endObject();return e.requiredField(n,4),n}static createOpIdKernelTypeStrArgsEntry(e,n,t){return r.startOpIdKernelTypeStrArgsEntry(e),r.addOpId(e,n),r.addKernelTypeStrArgs(e,t),r.endOpIdKernelTypeStrArgsEntry(e)}};En.OpIdKernelTypeStrArgsEntry=qu});var Xu=ie(Cn=>{"use strict";var RS=Cn&&Cn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),zS=Cn&&Cn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),MS=Cn&&Cn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&RS(n,e,t[o]);return zS(n,e),n}})();Object.defineProperty(Cn,"__esModule",{value:!0});Cn.KernelTypeStrResolver=void 0;var BS=MS(Me()),VS=ju(),Ku=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsKernelTypeStrResolver(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsKernelTypeStrResolver(e,n){return e.setPosition(e.position()+BS.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}opKernelTypeStrArgs(e,n){let t=this.bb.__offset(this.bb_pos,4);return t?(n||new VS.OpIdKernelTypeStrArgsEntry).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}opKernelTypeStrArgsLength(){let e=this.bb.__offset(this.bb_pos,4);return e?this.bb.__vector_len(this.bb_pos+e):0}static startKernelTypeStrResolver(e){e.startObject(1)}static addOpKernelTypeStrArgs(e,n){e.addFieldOffset(0,n,0)}static createOpKernelTypeStrArgsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startOpKernelTypeStrArgsVector(e,n){e.startVector(4,n,4)}static endKernelTypeStrResolver(e){return e.endObject()}static createKernelTypeStrResolver(e,n){return r.startKernelTypeStrResolver(e),r.addOpKernelTypeStrArgs(e,n),r.endKernelTypeStrResolver(e)}};Cn.KernelTypeStrResolver=Ku});var Ju=ie(Dn=>{"use strict";var GS=Dn&&Dn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),US=Dn&&Dn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),FS=Dn&&Dn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&GS(n,e,t[o]);return US(n,e),n}})();Object.defineProperty(Dn,"__esModule",{value:!0});Dn.OperatorSetId=void 0;var WS=FS(Me()),Zu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsOperatorSetId(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsOperatorSetId(e,n){return e.setPosition(e.position()+WS.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}domain(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.__string(this.bb_pos+n,e):null}version(){let e=this.bb.__offset(this.bb_pos,6);return e?this.bb.readInt64(this.bb_pos+e):BigInt("0")}static startOperatorSetId(e){e.startObject(2)}static addDomain(e,n){e.addFieldOffset(0,n,0)}static addVersion(e,n){e.addFieldInt64(1,n,BigInt("0"))}static endOperatorSetId(e){return e.endObject()}static createOperatorSetId(e,n,t){return r.startOperatorSetId(e),r.addDomain(e,n),r.addVersion(e,t),r.endOperatorSetId(e)}};Dn.OperatorSetId=Zu});var Qu=ie(kn=>{"use strict";var HS=kn&&kn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),qS=kn&&kn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),jS=kn&&kn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&HS(n,e,t[o]);return qS(n,e),n}})();Object.defineProperty(kn,"__esModule",{value:!0});kn.StringStringEntry=void 0;var KS=jS(Me()),Yu=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsStringStringEntry(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsStringStringEntry(e,n){return e.setPosition(e.position()+KS.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}key(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.__string(this.bb_pos+n,e):null}value(e){let n=this.bb.__offset(this.bb_pos,6);return n?this.bb.__string(this.bb_pos+n,e):null}static startStringStringEntry(e){e.startObject(2)}static addKey(e,n){e.addFieldOffset(0,n,0)}static addValue(e,n){e.addFieldOffset(1,n,0)}static endStringStringEntry(e){return e.endObject()}static createStringStringEntry(e,n,t){return r.startStringStringEntry(e),r.addKey(e,n),r.addValue(e,t),r.endStringStringEntry(e)}};kn.StringStringEntry=Yu});var tl=ie(Nn=>{"use strict";var XS=Nn&&Nn.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),ZS=Nn&&Nn.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),JS=Nn&&Nn.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&XS(n,e,t[o]);return ZS(n,e),n}})();Object.defineProperty(Nn,"__esModule",{value:!0});Nn.Model=void 0;var YS=JS(Me()),QS=Ni(),e$=Ju(),t$=Qu(),el=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsModel(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsModel(e,n){return e.setPosition(e.position()+YS.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}irVersion(){let e=this.bb.__offset(this.bb_pos,4);return e?this.bb.readInt64(this.bb_pos+e):BigInt("0")}opsetImport(e,n){let t=this.bb.__offset(this.bb_pos,6);return t?(n||new e$.OperatorSetId).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}opsetImportLength(){let e=this.bb.__offset(this.bb_pos,6);return e?this.bb.__vector_len(this.bb_pos+e):0}producerName(e){let n=this.bb.__offset(this.bb_pos,8);return n?this.bb.__string(this.bb_pos+n,e):null}producerVersion(e){let n=this.bb.__offset(this.bb_pos,10);return n?this.bb.__string(this.bb_pos+n,e):null}domain(e){let n=this.bb.__offset(this.bb_pos,12);return n?this.bb.__string(this.bb_pos+n,e):null}modelVersion(){let e=this.bb.__offset(this.bb_pos,14);return e?this.bb.readInt64(this.bb_pos+e):BigInt("0")}docString(e){let n=this.bb.__offset(this.bb_pos,16);return n?this.bb.__string(this.bb_pos+n,e):null}graph(e){let n=this.bb.__offset(this.bb_pos,18);return n?(e||new QS.Graph).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}graphDocString(e){let n=this.bb.__offset(this.bb_pos,20);return n?this.bb.__string(this.bb_pos+n,e):null}metadataProps(e,n){let t=this.bb.__offset(this.bb_pos,22);return t?(n||new t$.StringStringEntry).__init(this.bb.__indirect(this.bb.__vector(this.bb_pos+t)+e*4),this.bb):null}metadataPropsLength(){let e=this.bb.__offset(this.bb_pos,22);return e?this.bb.__vector_len(this.bb_pos+e):0}static startModel(e){e.startObject(10)}static addIrVersion(e,n){e.addFieldInt64(0,n,BigInt("0"))}static addOpsetImport(e,n){e.addFieldOffset(1,n,0)}static createOpsetImportVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startOpsetImportVector(e,n){e.startVector(4,n,4)}static addProducerName(e,n){e.addFieldOffset(2,n,0)}static addProducerVersion(e,n){e.addFieldOffset(3,n,0)}static addDomain(e,n){e.addFieldOffset(4,n,0)}static addModelVersion(e,n){e.addFieldInt64(5,n,BigInt("0"))}static addDocString(e,n){e.addFieldOffset(6,n,0)}static addGraph(e,n){e.addFieldOffset(7,n,0)}static addGraphDocString(e,n){e.addFieldOffset(8,n,0)}static addMetadataProps(e,n){e.addFieldOffset(9,n,0)}static createMetadataPropsVector(e,n){e.startVector(4,n.length,4);for(let t=n.length-1;t>=0;t--)e.addOffset(n[t]);return e.endVector()}static startMetadataPropsVector(e,n){e.startVector(4,n,4)}static endModel(e){return e.endObject()}};Nn.Model=el});var ih=ie(Ln=>{"use strict";var n$=Ln&&Ln.__createBinding||(Object.create?function(r,e,n,t){t===void 0&&(t=n);var o=Object.getOwnPropertyDescriptor(e,n);(!o||("get"in o?!e.__esModule:o.writable||o.configurable))&&(o={enumerable:!0,get:function(){return e[n]}}),Object.defineProperty(r,t,o)}:function(r,e,n,t){t===void 0&&(t=n),r[t]=e[n]}),r$=Ln&&Ln.__setModuleDefault||(Object.create?function(r,e){Object.defineProperty(r,"default",{enumerable:!0,value:e})}:function(r,e){r.default=e}),o$=Ln&&Ln.__importStar||(function(){var r=function(e){return r=Object.getOwnPropertyNames||function(n){var t=[];for(var o in n)Object.prototype.hasOwnProperty.call(n,o)&&(t[t.length]=o);return t},r(e)};return function(e){if(e&&e.__esModule)return e;var n={};if(e!=null)for(var t=r(e),o=0;o<t.length;o++)t[o]!=="default"&&n$(n,e,t[o]);return r$(n,e),n}})();Object.defineProperty(Ln,"__esModule",{value:!0});Ln.InferenceSession=void 0;var i$=o$(Me()),a$=Xu(),s$=tl(),nl=class r{constructor(){this.bb=null,this.bb_pos=0}__init(e,n){return this.bb_pos=e,this.bb=n,this}static getRootAsInferenceSession(e,n){return(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static getSizePrefixedRootAsInferenceSession(e,n){return e.setPosition(e.position()+i$.SIZE_PREFIX_LENGTH),(n||new r).__init(e.readInt32(e.position())+e.position(),e)}static bufferHasIdentifier(e){return e.__has_identifier("ORTM")}ortVersion(e){let n=this.bb.__offset(this.bb_pos,4);return n?this.bb.__string(this.bb_pos+n,e):null}model(e){let n=this.bb.__offset(this.bb_pos,6);return n?(e||new s$.Model).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}kernelTypeStrResolver(e){let n=this.bb.__offset(this.bb_pos,10);return n?(e||new a$.KernelTypeStrResolver).__init(this.bb.__indirect(this.bb_pos+n),this.bb):null}static startInferenceSession(e){e.startObject(4)}static addOrtVersion(e,n){e.addFieldOffset(0,n,0)}static addModel(e,n){e.addFieldOffset(1,n,0)}static addKernelTypeStrResolver(e,n){e.addFieldOffset(3,n,0)}static endInferenceSession(e){return e.endObject()}static finishInferenceSessionBuffer(e,n){e.finish(n,"ORTM")}static finishSizePrefixedInferenceSessionBuffer(e,n){e.finish(n,"ORTM",!0)}};Ln.InferenceSession=nl});var u$,l$,Li,zt,c$,d$,p$,f$,h$,m$,g$,b$,rl,ol,y$,_$,w$,v$,il,x$,T$,I$,S$,$$,A$,O$,P$,E$,C$,D$,k$,N$,So,al,L$,sl,R$,ah=L(()=>{"use strict";u$=ve(Ws()),l$=ve(Js()),Li=ve(nu()),zt=ve(Ys()),c$=ve(Mu()),d$=ve(oh()),p$=ve(Uu()),f$=ve(Gu()),h$=ve($u()),m$=ve(Iu()),g$=ve(xu()),b$=ve(ou()),rl=ve(Ni()),ol=ve(ih()),y$=ve(Hu()),_$=ve(Xu()),w$=ve(_u()),v$=ve(tl()),il=ve(tu()),x$=ve(au()),T$=ve(Qs()),I$=ve(uu()),S$=ve(ju()),$$=ve(Ju()),A$=ve(cu()),O$=ve(pu()),P$=ve(hu()),E$=ve(vu()),C$=ve(Ou()),D$=ve(bu()),k$=ve(Qu()),N$=ve(To()),So=ve(xo()),al=ve(Eu()),L$=ve(Io()),sl=ve(Cu()),R$=ve(Nu())});var $o=L(()=>{"use strict";ah()});var uh=ie((fN,sh)=>{"use strict";sh.exports=z$;function z$(r,e){for(var n=new Array(arguments.length-1),t=0,o=2,i=!0;o<arguments.length;)n[t++]=arguments[o++];return new Promise(function(s,u){n[t]=function(d){if(i)if(i=!1,d)u(d);else{for(var p=new Array(arguments.length-1),h=0;h<p.length;)p[h++]=arguments[h];s.apply(null,p)}};try{r.apply(e||null,n)}catch(l){i&&(i=!1,u(l))}})}});var ph=ie(dh=>{"use strict";var zi=dh;zi.length=function(e){var n=e.length;if(!n)return 0;for(var t=0;--n%4>1&&e.charAt(n)==="=";)++t;return Math.ceil(e.length*3)/4-t};var Yr=new Array(64),ch=new Array(123);for(jt=0;jt<64;)ch[Yr[jt]=jt<26?jt+65:jt<52?jt+71:jt<62?jt-4:jt-59|43]=jt++;var jt;zi.encode=function(e,n,t){for(var o=null,i=[],a=0,s=0,u;n<t;){var l=e[n++];switch(s){case 0:i[a++]=Yr[l>>2],u=(l&3)<<4,s=1;break;case 1:i[a++]=Yr[u|l>>4],u=(l&15)<<2,s=2;break;case 2:i[a++]=Yr[u|l>>6],i[a++]=Yr[l&63],s=0;break}a>8191&&((o||(o=[])).push(String.fromCharCode.apply(String,i)),a=0)}return s&&(i[a++]=Yr[u],i[a++]=61,s===1&&(i[a++]=61)),o?(a&&o.push(String.fromCharCode.apply(String,i.slice(0,a))),o.join("")):String.fromCharCode.apply(String,i.slice(0,a))};var lh="invalid encoding";zi.decode=function(e,n,t){for(var o=t,i=0,a,s=0;s<e.length;){var u=e.charCodeAt(s++);if(u===61&&i>1)break;if((u=ch[u])===void 0)throw Error(lh);switch(i){case 0:a=u,i=1;break;case 1:n[t++]=a<<2|(u&48)>>4,a=u,i=2;break;case 2:n[t++]=(a&15)<<4|(u&60)>>2,a=u,i=3;break;case 3:n[t++]=(a&3)<<6|u,i=0;break}}if(i===1)throw Error(lh);return t-o};zi.test=function(e){return/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(e)}});var hh=ie((mN,fh)=>{"use strict";fh.exports=Mi;function Mi(){this._listeners={}}Mi.prototype.on=function(e,n,t){return(this._listeners[e]||(this._listeners[e]=[])).push({fn:n,ctx:t||this}),this};Mi.prototype.off=function(e,n){if(e===void 0)this._listeners={};else if(n===void 0)this._listeners[e]=[];else for(var t=this._listeners[e],o=0;o<t.length;)t[o].fn===n?t.splice(o,1):++o;return this};Mi.prototype.emit=function(e){var n=this._listeners[e];if(n){for(var t=[],o=1;o<arguments.length;)t.push(arguments[o++]);for(o=0;o<n.length;)n[o].fn.apply(n[o++].ctx,t)}return this}});var vh=ie((gN,wh)=>{"use strict";wh.exports=mh(mh);function mh(r){return typeof Float32Array<"u"?(function(){var e=new Float32Array([-0]),n=new Uint8Array(e.buffer),t=n[3]===128;function o(u,l,d){e[0]=u,l[d]=n[0],l[d+1]=n[1],l[d+2]=n[2],l[d+3]=n[3]}function i(u,l,d){e[0]=u,l[d]=n[3],l[d+1]=n[2],l[d+2]=n[1],l[d+3]=n[0]}r.writeFloatLE=t?o:i,r.writeFloatBE=t?i:o;function a(u,l){return n[0]=u[l],n[1]=u[l+1],n[2]=u[l+2],n[3]=u[l+3],e[0]}function s(u,l){return n[3]=u[l],n[2]=u[l+1],n[1]=u[l+2],n[0]=u[l+3],e[0]}r.readFloatLE=t?a:s,r.readFloatBE=t?s:a})():(function(){function e(t,o,i,a){var s=o<0?1:0;if(s&&(o=-o),o===0)t(1/o>0?0:2147483648,i,a);else if(isNaN(o))t(2143289344,i,a);else if(o>34028234663852886e22)t((s<<31|2139095040)>>>0,i,a);else if(o<11754943508222875e-54)t((s<<31|Math.round(o/1401298464324817e-60))>>>0,i,a);else{var u=Math.floor(Math.log(o)/Math.LN2),l=Math.round(o*Math.pow(2,-u)*8388608)&8388607;t((s<<31|u+127<<23|l)>>>0,i,a)}}r.writeFloatLE=e.bind(null,gh),r.writeFloatBE=e.bind(null,bh);function n(t,o,i){var a=t(o,i),s=(a>>31)*2+1,u=a>>>23&255,l=a&8388607;return u===255?l?NaN:s*(1/0):u===0?s*1401298464324817e-60*l:s*Math.pow(2,u-150)*(l+8388608)}r.readFloatLE=n.bind(null,yh),r.readFloatBE=n.bind(null,_h)})(),typeof Float64Array<"u"?(function(){var e=new Float64Array([-0]),n=new Uint8Array(e.buffer),t=n[7]===128;function o(u,l,d){e[0]=u,l[d]=n[0],l[d+1]=n[1],l[d+2]=n[2],l[d+3]=n[3],l[d+4]=n[4],l[d+5]=n[5],l[d+6]=n[6],l[d+7]=n[7]}function i(u,l,d){e[0]=u,l[d]=n[7],l[d+1]=n[6],l[d+2]=n[5],l[d+3]=n[4],l[d+4]=n[3],l[d+5]=n[2],l[d+6]=n[1],l[d+7]=n[0]}r.writeDoubleLE=t?o:i,r.writeDoubleBE=t?i:o;function a(u,l){return n[0]=u[l],n[1]=u[l+1],n[2]=u[l+2],n[3]=u[l+3],n[4]=u[l+4],n[5]=u[l+5],n[6]=u[l+6],n[7]=u[l+7],e[0]}function s(u,l){return n[7]=u[l],n[6]=u[l+1],n[5]=u[l+2],n[4]=u[l+3],n[3]=u[l+4],n[2]=u[l+5],n[1]=u[l+6],n[0]=u[l+7],e[0]}r.readDoubleLE=t?a:s,r.readDoubleBE=t?s:a})():(function(){function e(t,o,i,a,s,u){var l=a<0?1:0;if(l&&(a=-a),a===0)t(0,s,u+o),t(1/a>0?0:2147483648,s,u+i);else if(isNaN(a))t(0,s,u+o),t(2146959360,s,u+i);else if(a>17976931348623157e292)t(0,s,u+o),t((l<<31|2146435072)>>>0,s,u+i);else{var d;if(a<22250738585072014e-324)d=a/5e-324,t(d>>>0,s,u+o),t((l<<31|d/4294967296)>>>0,s,u+i);else{var p=Math.floor(Math.log(a)/Math.LN2);p===1024&&(p=1023),d=a*Math.pow(2,-p),t(d*4503599627370496>>>0,s,u+o),t((l<<31|p+1023<<20|d*1048576&1048575)>>>0,s,u+i)}}}r.writeDoubleLE=e.bind(null,gh,0,4),r.writeDoubleBE=e.bind(null,bh,4,0);function n(t,o,i,a,s){var u=t(a,s+o),l=t(a,s+i),d=(l>>31)*2+1,p=l>>>20&2047,h=4294967296*(l&1048575)+u;return p===2047?h?NaN:d*(1/0):p===0?d*5e-324*h:d*Math.pow(2,p-1075)*(h+4503599627370496)}r.readDoubleLE=n.bind(null,yh,0,4),r.readDoubleBE=n.bind(null,_h,4,0)})(),r}function gh(r,e,n){e[n]=r&255,e[n+1]=r>>>8&255,e[n+2]=r>>>16&255,e[n+3]=r>>>24}function bh(r,e,n){e[n]=r>>>24,e[n+1]=r>>>16&255,e[n+2]=r>>>8&255,e[n+3]=r&255}function yh(r,e){return(r[e]|r[e+1]<<8|r[e+2]<<16|r[e+3]<<24)>>>0}function _h(r,e){return(r[e]<<24|r[e+1]<<16|r[e+2]<<8|r[e+3])>>>0}});var Th=ie((bN,xh)=>{"use strict";xh.exports=M$;function M$(r){try{if(typeof jr!="function")return null;var e=jr(r);return e&&(e.length||Object.keys(e).length)?e:null}catch{return null}}});var Sh=ie(Ih=>{"use strict";var ll=Ih,ul="\uFFFD";ll.length=function(e){for(var n=0,t=0,o=0;o<e.length;++o)t=e.charCodeAt(o),t<128?n+=1:t<2048?n+=2:(t&64512)===55296&&(e.charCodeAt(o+1)&64512)===56320?(++o,n+=4):n+=3;return n};ll.read=function(e,n,t){if(t-n<1)return"";for(var o="",i=n;i<t;){var a=e[i++];if(a<=127)o+=String.fromCharCode(a);else if(a>=192&&a<224){var s=(a&31)<<6|e[i++]&63;o+=s>=128?String.fromCharCode(s):ul}else if(a>=224&&a<240){var u=(a&15)<<12|(e[i++]&63)<<6|e[i++]&63;o+=u>=2048?String.fromCharCode(u):ul}else if(a>=240){var l=(a&7)<<18|(e[i++]&63)<<12|(e[i++]&63)<<6|e[i++]&63;l<65536||l>1114111?o+=ul:(l-=65536,o+=String.fromCharCode(55296+(l>>10)),o+=String.fromCharCode(56320+(l&1023)))}}return o};ll.write=function(e,n,t){for(var o=t,i,a,s=0;s<e.length;++s)i=e.charCodeAt(s),i<128?n[t++]=i:i<2048?(n[t++]=i>>6|192,n[t++]=i&63|128):(i&64512)===55296&&((a=e.charCodeAt(s+1))&64512)===56320?(i=65536+((i&1023)<<10)+(a&1023),++s,n[t++]=i>>18|240,n[t++]=i>>12&63|128,n[t++]=i>>6&63|128,n[t++]=i&63|128):(n[t++]=i>>12|224,n[t++]=i>>6&63|128,n[t++]=i&63|128);return t-o}});var Ah=ie((wN,$h)=>{"use strict";$h.exports=B$;function B$(r,e,n){var t=n||8192,o=t>>>1,i=null,a=t;return function(u){if(u<1||u>o)return r(u);a+u>t&&(i=r(t),a=0);var l=e.call(i,a,a+=u);return a&7&&(a=(a|7)+1),l}}});var Ph=ie((vN,Oh)=>{"use strict";Oh.exports=dt;var Ao=pr();function dt(r,e){this.lo=r>>>0,this.hi=e>>>0}var Or=dt.zero=new dt(0,0);Or.toNumber=function(){return 0};Or.zzEncode=Or.zzDecode=function(){return this};Or.length=function(){return 1};var V$=dt.zeroHash="\0\0\0\0\0\0\0\0";dt.fromNumber=function(e){if(e===0)return Or;var n=e<0;n&&(e=-e);var t=e>>>0,o=(e-t)/4294967296>>>0;return n&&(o=~o>>>0,t=~t>>>0,++t>4294967295&&(t=0,++o>4294967295&&(o=0))),new dt(t,o)};dt.from=function(e){if(typeof e=="number")return dt.fromNumber(e);if(Ao.isString(e))if(Ao.Long)e=Ao.Long.fromString(e);else return dt.fromNumber(parseInt(e,10));return e.low||e.high?new dt(e.low>>>0,e.high>>>0):Or};dt.prototype.toNumber=function(e){if(!e&&this.hi>>>31){var n=~this.lo+1>>>0,t=~this.hi>>>0;return n||(t=t+1>>>0),-(n+t*4294967296)}return this.lo+this.hi*4294967296};dt.prototype.toLong=function(e){return Ao.Long?new Ao.Long(this.lo|0,this.hi|0,!!e):{low:this.lo|0,high:this.hi|0,unsigned:!!e}};var dr=String.prototype.charCodeAt;dt.fromHash=function(e){return e===V$?Or:new dt((dr.call(e,0)|dr.call(e,1)<<8|dr.call(e,2)<<16|dr.call(e,3)<<24)>>>0,(dr.call(e,4)|dr.call(e,5)<<8|dr.call(e,6)<<16|dr.call(e,7)<<24)>>>0)};dt.prototype.toHash=function(){return String.fromCharCode(this.lo&255,this.lo>>>8&255,this.lo>>>16&255,this.lo>>>24,this.hi&255,this.hi>>>8&255,this.hi>>>16&255,this.hi>>>24)};dt.prototype.zzEncode=function(){var e=this.hi>>31;return this.hi=((this.hi<<1|this.lo>>>31)^e)>>>0,this.lo=(this.lo<<1^e)>>>0,this};dt.prototype.zzDecode=function(){var e=-(this.lo&1);return this.lo=((this.lo>>>1|this.hi<<31)^e)>>>0,this.hi=(this.hi>>>1^e)>>>0,this};dt.prototype.length=function(){var e=this.lo,n=(this.lo>>>28|this.hi<<4)>>>0,t=this.hi>>>24;return t===0?n===0?e<16384?e<128?1:2:e<2097152?3:4:n<16384?n<128?5:6:n<2097152?7:8:t<128?9:10}});var Eh=ie((Oo,cl)=>{(function(r,e){function n(t){return t.default||t}typeof define=="function"&&define.amd?define([],function(){var t={};return e(t),n(t)}):typeof Oo=="object"?(e(Oo),typeof cl=="object"&&(cl.exports=n(Oo))):(function(){var t={};e(t),r.Long=n(t)})()})(typeof globalThis<"u"?globalThis:typeof self<"u"?self:Oo,function(r){"use strict";Object.defineProperty(r,"__esModule",{value:!0}),r.default=void 0;var e=null;try{e=new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array([0,97,115,109,1,0,0,0,1,13,2,96,0,1,127,96,4,127,127,127,127,1,127,3,7,6,0,1,1,1,1,1,6,6,1,127,1,65,0,11,7,50,6,3,109,117,108,0,1,5,100,105,118,95,115,0,2,5,100,105,118,95,117,0,3,5,114,101,109,95,115,0,4,5,114,101,109,95,117,0,5,8,103,101,116,95,104,105,103,104,0,0,10,191,1,6,4,0,35,0,11,36,1,1,126,32,0,173,32,1,173,66,32,134,132,32,2,173,32,3,173,66,32,134,132,126,34,4,66,32,135,167,36,0,32,4,167,11,36,1,1,126,32,0,173,32,1,173,66,32,134,132,32,2,173,32,3,173,66,32,134,132,127,34,4,66,32,135,167,36,0,32,4,167,11,36,1,1,126,32,0,173,32,1,173,66,32,134,132,32,2,173,32,3,173,66,32,134,132,128,34,4,66,32,135,167,36,0,32,4,167,11,36,1,1,126,32,0,173,32,1,173,66,32,134,132,32,2,173,32,3,173,66,32,134,132,129,34,4,66,32,135,167,36,0,32,4,167,11,36,1,1,126,32,0,173,32,1,173,66,32,134,132,32,2,173,32,3,173,66,32,134,132,130,34,4,66,32,135,167,36,0,32,4,167,11])),{}).exports}catch{}function n(V,w,R){this.low=V|0,this.high=w|0,this.unsigned=!!R}n.prototype.__isLong__,Object.defineProperty(n.prototype,"__isLong__",{value:!0});function t(V){return(V&&V.__isLong__)===!0}function o(V){var w=Math.clz32(V&-V);return V?31-w:w}n.isLong=t;var i={},a={};function s(V,w){var R,j,J;return w?(V>>>=0,(J=0<=V&&V<256)&&(j=a[V],j)?j:(R=l(V,0,!0),J&&(a[V]=R),R)):(V|=0,(J=-128<=V&&V<128)&&(j=i[V],j)?j:(R=l(V,V<0?-1:0,!1),J&&(i[V]=R),R))}n.fromInt=s;function u(V,w){if(isNaN(V))return w?O:$;if(w){if(V<0)return O;if(V>=S)return F}else{if(V<=-v)return W;if(V+1>=v)return T}return V<0?u(-V,w).neg():l(V%_|0,V/_|0,w)}n.fromNumber=u;function l(V,w,R){return new n(V,w,R)}n.fromBits=l;var d=Math.pow;function p(V,w,R){if(V.length===0)throw Error("empty string");if(typeof w=="number"?(R=w,w=!1):w=!!w,V==="NaN"||V==="Infinity"||V==="+Infinity"||V==="-Infinity")return w?O:$;if(R=R||10,R<2||36<R)throw RangeError("radix");var j;if((j=V.indexOf("-"))>0)throw Error("interior hyphen");if(j===0)return p(V.substring(1),w,R).neg();for(var J=u(d(R,8)),Z=$,oe=0;oe<V.length;oe+=8){var se=Math.min(8,V.length-oe),pe=parseInt(V.substring(oe,oe+se),R);if(se<8){var De=u(d(R,se));Z=Z.mul(De).add(u(pe))}else Z=Z.mul(J),Z=Z.add(u(pe))}return Z.unsigned=w,Z}n.fromString=p;function h(V,w){return typeof V=="number"?u(V,w):typeof V=="string"?p(V,w):l(V.low,V.high,typeof w=="boolean"?w:V.unsigned)}n.fromValue=h;var g=65536,b=1<<24,_=g*g,S=_*_,v=S/2,x=s(b),$=s(0);n.ZERO=$;var O=s(0,!0);n.UZERO=O;var E=s(1);n.ONE=E;var D=s(1,!0);n.UONE=D;var B=s(-1);n.NEG_ONE=B;var T=l(-1,2147483647,!1);n.MAX_VALUE=T;var F=l(-1,-1,!0);n.MAX_UNSIGNED_VALUE=F;var W=l(0,-2147483648,!1);n.MIN_VALUE=W;var z=n.prototype;z.toInt=function(){return this.unsigned?this.low>>>0:this.low},z.toNumber=function(){return this.unsigned?(this.high>>>0)*_+(this.low>>>0):this.high*_+(this.low>>>0)},z.toString=function(w){if(w=w||10,w<2||36<w)throw RangeError("radix");if(this.isZero())return"0";if(this.isNegative())if(this.eq(W)){var R=u(w),j=this.div(R),J=j.mul(R).sub(this);return j.toString(w)+J.toInt().toString(w)}else return"-"+this.neg().toString(w);for(var Z=u(d(w,6),this.unsigned),oe=this,se="";;){var pe=oe.div(Z),De=oe.sub(pe.mul(Z)).toInt()>>>0,fe=De.toString(w);if(oe=pe,oe.isZero())return fe+se;for(;fe.length<6;)fe="0"+fe;se=""+fe+se}},z.getHighBits=function(){return this.high},z.getHighBitsUnsigned=function(){return this.high>>>0},z.getLowBits=function(){return this.low},z.getLowBitsUnsigned=function(){return this.low>>>0},z.getNumBitsAbs=function(){if(this.isNegative())return this.eq(W)?64:this.neg().getNumBitsAbs();for(var w=this.high!=0?this.high:this.low,R=31;R>0&&(w&1<<R)==0;R--);return this.high!=0?R+33:R+1},z.isSafeInteger=function(){var w=this.high>>21;return w?this.unsigned?!1:w===-1&&!(this.low===0&&this.high===-2097152):!0},z.isZero=function(){return this.high===0&&this.low===0},z.eqz=z.isZero,z.isNegative=function(){return!this.unsigned&&this.high<0},z.isPositive=function(){return this.unsigned||this.high>=0},z.isOdd=function(){return(this.low&1)===1},z.isEven=function(){return(this.low&1)===0},z.equals=function(w){return t(w)||(w=h(w)),this.unsigned!==w.unsigned&&this.high>>>31===1&&w.high>>>31===1?!1:this.high===w.high&&this.low===w.low},z.eq=z.equals,z.notEquals=function(w){return!this.eq(w)},z.neq=z.notEquals,z.ne=z.notEquals,z.lessThan=function(w){return this.comp(w)<0},z.lt=z.lessThan,z.lessThanOrEqual=function(w){return this.comp(w)<=0},z.lte=z.lessThanOrEqual,z.le=z.lessThanOrEqual,z.greaterThan=function(w){return this.comp(w)>0},z.gt=z.greaterThan,z.greaterThanOrEqual=function(w){return this.comp(w)>=0},z.gte=z.greaterThanOrEqual,z.ge=z.greaterThanOrEqual,z.compare=function(w){if(t(w)||(w=h(w)),this.eq(w))return 0;var R=this.isNegative(),j=w.isNegative();return R&&!j?-1:!R&&j?1:this.unsigned?w.high>>>0>this.high>>>0||w.high===this.high&&w.low>>>0>this.low>>>0?-1:1:this.sub(w).isNegative()?-1:1},z.comp=z.compare,z.negate=function(){return!this.unsigned&&this.eq(W)?W:this.not().add(E)},z.neg=z.negate,z.add=function(w){t(w)||(w=h(w));var R=this.high>>>16,j=this.high&65535,J=this.low>>>16,Z=this.low&65535,oe=w.high>>>16,se=w.high&65535,pe=w.low>>>16,De=w.low&65535,fe=0,U=0,q=0,ye=0;return ye+=Z+De,q+=ye>>>16,ye&=65535,q+=J+pe,U+=q>>>16,q&=65535,U+=j+se,fe+=U>>>16,U&=65535,fe+=R+oe,fe&=65535,l(q<<16|ye,fe<<16|U,this.unsigned)},z.subtract=function(w){return t(w)||(w=h(w)),this.add(w.neg())},z.sub=z.subtract,z.multiply=function(w){if(this.isZero())return this;if(t(w)||(w=h(w)),e){var R=e.mul(this.low,this.high,w.low,w.high);return l(R,e.get_high(),this.unsigned)}if(w.isZero())return this.unsigned?O:$;if(this.eq(W))return w.isOdd()?W:$;if(w.eq(W))return this.isOdd()?W:$;if(this.isNegative())return w.isNegative()?this.neg().mul(w.neg()):this.neg().mul(w).neg();if(w.isNegative())return this.mul(w.neg()).neg();if(this.lt(x)&&w.lt(x))return u(this.toNumber()*w.toNumber(),this.unsigned);var j=this.high>>>16,J=this.high&65535,Z=this.low>>>16,oe=this.low&65535,se=w.high>>>16,pe=w.high&65535,De=w.low>>>16,fe=w.low&65535,U=0,q=0,ye=0,Je=0;return Je+=oe*fe,ye+=Je>>>16,Je&=65535,ye+=Z*fe,q+=ye>>>16,ye&=65535,ye+=oe*De,q+=ye>>>16,ye&=65535,q+=J*fe,U+=q>>>16,q&=65535,q+=Z*De,U+=q>>>16,q&=65535,q+=oe*pe,U+=q>>>16,q&=65535,U+=j*fe+J*De+Z*pe+oe*se,U&=65535,l(ye<<16|Je,U<<16|q,this.unsigned)},z.mul=z.multiply,z.divide=function(w){if(t(w)||(w=h(w)),w.isZero())throw Error("division by zero");if(e){if(!this.unsigned&&this.high===-2147483648&&w.low===-1&&w.high===-1)return this;var R=(this.unsigned?e.div_u:e.div_s)(this.low,this.high,w.low,w.high);return l(R,e.get_high(),this.unsigned)}if(this.isZero())return this.unsigned?O:$;var j,J,Z;if(this.unsigned){if(w.unsigned||(w=w.toUnsigned()),w.gt(this))return O;if(w.gt(this.shru(1)))return D;Z=O}else{if(this.eq(W)){if(w.eq(E)||w.eq(B))return W;if(w.eq(W))return E;var oe=this.shr(1);return j=oe.div(w).shl(1),j.eq($)?w.isNegative()?E:B:(J=this.sub(w.mul(j)),Z=j.add(J.div(w)),Z)}else if(w.eq(W))return this.unsigned?O:$;if(this.isNegative())return w.isNegative()?this.neg().div(w.neg()):this.neg().div(w).neg();if(w.isNegative())return this.div(w.neg()).neg();Z=$}for(J=this;J.gte(w);){j=Math.max(1,Math.floor(J.toNumber()/w.toNumber()));for(var se=Math.ceil(Math.log(j)/Math.LN2),pe=se<=48?1:d(2,se-48),De=u(j),fe=De.mul(w);fe.isNegative()||fe.gt(J);)j-=pe,De=u(j,this.unsigned),fe=De.mul(w);De.isZero()&&(De=E),Z=Z.add(De),J=J.sub(fe)}return Z},z.div=z.divide,z.modulo=function(w){if(t(w)||(w=h(w)),e){var R=(this.unsigned?e.rem_u:e.rem_s)(this.low,this.high,w.low,w.high);return l(R,e.get_high(),this.unsigned)}return this.sub(this.div(w).mul(w))},z.mod=z.modulo,z.rem=z.modulo,z.not=function(){return l(~this.low,~this.high,this.unsigned)},z.countLeadingZeros=function(){return this.high?Math.clz32(this.high):Math.clz32(this.low)+32},z.clz=z.countLeadingZeros,z.countTrailingZeros=function(){return this.low?o(this.low):o(this.high)+32},z.ctz=z.countTrailingZeros,z.and=function(w){return t(w)||(w=h(w)),l(this.low&w.low,this.high&w.high,this.unsigned)},z.or=function(w){return t(w)||(w=h(w)),l(this.low|w.low,this.high|w.high,this.unsigned)},z.xor=function(w){return t(w)||(w=h(w)),l(this.low^w.low,this.high^w.high,this.unsigned)},z.shiftLeft=function(w){return t(w)&&(w=w.toInt()),(w&=63)===0?this:w<32?l(this.low<<w,this.high<<w|this.low>>>32-w,this.unsigned):l(0,this.low<<w-32,this.unsigned)},z.shl=z.shiftLeft,z.shiftRight=function(w){return t(w)&&(w=w.toInt()),(w&=63)===0?this:w<32?l(this.low>>>w|this.high<<32-w,this.high>>w,this.unsigned):l(this.high>>w-32,this.high>=0?0:-1,this.unsigned)},z.shr=z.shiftRight,z.shiftRightUnsigned=function(w){return t(w)&&(w=w.toInt()),(w&=63)===0?this:w<32?l(this.low>>>w|this.high<<32-w,this.high>>>w,this.unsigned):w===32?l(this.high,0,this.unsigned):l(this.high>>>w-32,0,this.unsigned)},z.shru=z.shiftRightUnsigned,z.shr_u=z.shiftRightUnsigned,z.rotateLeft=function(w){var R;return t(w)&&(w=w.toInt()),(w&=63)===0?this:w===32?l(this.high,this.low,this.unsigned):w<32?(R=32-w,l(this.low<<w|this.high>>>R,this.high<<w|this.low>>>R,this.unsigned)):(w-=32,R=32-w,l(this.high<<w|this.low>>>R,this.low<<w|this.high>>>R,this.unsigned))},z.rotl=z.rotateLeft,z.rotateRight=function(w){var R;return t(w)&&(w=w.toInt()),(w&=63)===0?this:w===32?l(this.high,this.low,this.unsigned):w<32?(R=32-w,l(this.high<<R|this.low>>>w,this.low<<R|this.high>>>w,this.unsigned)):(w-=32,R=32-w,l(this.low<<R|this.high>>>w,this.high<<R|this.low>>>w,this.unsigned))},z.rotr=z.rotateRight,z.toSigned=function(){return this.unsigned?l(this.low,this.high,!1):this},z.toUnsigned=function(){return this.unsigned?this:l(this.low,this.high,!0)},z.toBytes=function(w){return w?this.toBytesLE():this.toBytesBE()},z.toBytesLE=function(){var w=this.high,R=this.low;return[R&255,R>>>8&255,R>>>16&255,R>>>24,w&255,w>>>8&255,w>>>16&255,w>>>24]},z.toBytesBE=function(){var w=this.high,R=this.low;return[w>>>24,w>>>16&255,w>>>8&255,w&255,R>>>24,R>>>16&255,R>>>8&255,R&255]},n.fromBytes=function(w,R,j){return j?n.fromBytesLE(w,R):n.fromBytesBE(w,R)},n.fromBytesLE=function(w,R){return new n(w[0]|w[1]<<8|w[2]<<16|w[3]<<24,w[4]|w[5]<<8|w[6]<<16|w[7]<<24,R)},n.fromBytesBE=function(w,R){return new n(w[4]<<24|w[5]<<16|w[6]<<8|w[7],w[0]<<24|w[1]<<16|w[2]<<8|w[3],R)},typeof BigInt=="function"&&(n.fromBigInt=function(w,R){var j=Number(BigInt.asIntN(32,w)),J=Number(BigInt.asIntN(32,w>>BigInt(32)));return l(j,J,R)},n.fromValue=function(w,R){return typeof w=="bigint"?n.fromBigInt(w,R):h(w,R)},z.toBigInt=function(){var w=BigInt(this.low>>>0),R=BigInt(this.unsigned?this.high>>>0:this.high);return R<<BigInt(32)|w});var te=r.default=n})});var pr=ie(dl=>{"use strict";var ue=dl;ue.asPromise=uh();ue.base64=ph();ue.EventEmitter=hh();ue.float=vh();ue.inquire=Th();ue.utf8=Sh();ue.pool=Ah();ue.LongBits=Ph();ue.isNode=!!(typeof global<"u"&&global&&global.process&&global.process.versions&&global.process.versions.node);ue.global=ue.isNode&&global||typeof window<"u"&&window||typeof self<"u"&&self||dl;ue.emptyArray=Object.freeze?Object.freeze([]):[];ue.emptyObject=Object.freeze?Object.freeze({}):{};ue.isInteger=Number.isInteger||function(e){return typeof e=="number"&&isFinite(e)&&Math.floor(e)===e};ue.isString=function(e){return typeof e=="string"||e instanceof String};ue.isObject=function(e){return e&&typeof e=="object"};ue.isset=ue.isSet=function(e,n){var t=e[n];return t!=null&&e.hasOwnProperty(n)?typeof t!="object"||(Array.isArray(t)?t.length:Object.keys(t).length)>0:!1};ue.Buffer=(function(){try{var r=ue.global.Buffer;return r.prototype.utf8Write?r:null}catch{return null}})();ue._Buffer_from=null;ue._Buffer_allocUnsafe=null;ue.newBuffer=function(e){return typeof e=="number"?ue.Buffer?ue._Buffer_allocUnsafe(e):new ue.Array(e):ue.Buffer?ue._Buffer_from(e):typeof Uint8Array>"u"?e:new Uint8Array(e)};ue.Array=typeof Uint8Array<"u"?Uint8Array:Array;ue.Long=ue.global.dcodeIO&&ue.global.dcodeIO.Long||ue.global.Long||(function(){try{var r=Eh();return r&&r.isLong?r:null}catch{return null}})();ue.key2Re=/^true|false|0|1$/;ue.key32Re=/^-?(?:0|[1-9][0-9]*)$/;ue.key64Re=/^(?:[\\x00-\\xff]{8}|-?(?:0|[1-9][0-9]*))$/;ue.longToHash=function(e){return e?ue.LongBits.from(e).toHash():ue.LongBits.zeroHash};ue.longFromHash=function(e,n){var t=ue.LongBits.fromHash(e);return ue.Long?ue.Long.fromBits(t.lo,t.hi,n):t.toNumber(!!n)};function Ch(r,e,n){for(var t=Object.keys(e),o=0;o<t.length;++o)(r[t[o]]===void 0||!n)&&t[o]!=="__proto__"&&(r[t[o]]=e[t[o]]);return r}ue.merge=Ch;ue.recursionLimit=100;ue.makeProp=function(e,n){Object.defineProperty(e,n,{enumerable:!0,configurable:!0,writable:!0})};ue.lcFirst=function(e){return e.charAt(0).toLowerCase()+e.substring(1)};function Dh(r){function e(n,t){if(!(this instanceof e))return new e(n,t);Object.defineProperty(this,"message",{get:function(){return n}}),Error.captureStackTrace?Error.captureStackTrace(this,e):Object.defineProperty(this,"stack",{value:new Error().stack||""}),t&&Ch(this,t)}return e.prototype=Object.create(Error.prototype,{constructor:{value:e,writable:!0,enumerable:!1,configurable:!0},name:{get:function(){return r},set:void 0,enumerable:!1,configurable:!0},toString:{value:function(){return this.name+": "+this.message},writable:!0,enumerable:!1,configurable:!0}}),e}ue.newError=Dh;ue.ProtocolError=Dh("ProtocolError");ue.oneOfGetter=function(e){for(var n={},t=0;t<e.length;++t)n[e[t]]=1;return function(){for(var o=Object.keys(this),i=o.length-1;i>-1;--i)if(n[o[i]]===1&&this[o[i]]!==void 0&&this[o[i]]!==null)return o[i]}};ue.oneOfSetter=function(e){return function(n){for(var t=0;t<e.length;++t)e[t]!==n&&delete this[e[t]]}};ue.toJSONOptions={longs:String,enums:String,bytes:String,json:!0};ue._configure=function(){var r=ue.Buffer;if(!r){ue._Buffer_from=ue._Buffer_allocUnsafe=null;return}ue._Buffer_from=r.from!==Uint8Array.from&&r.from||function(n,t){return new r(n,t)},ue._Buffer_allocUnsafe=r.allocUnsafe||function(n){return new r(n)}}});var yl=ie((TN,Rh)=>{"use strict";Rh.exports=Le;var Mt=pr(),pl,Bi=Mt.LongBits,kh=Mt.base64,Nh=Mt.utf8;function Po(r,e,n){this.fn=r,this.len=e,this.next=void 0,this.val=n}function hl(){}function G$(r){this.head=r.head,this.tail=r.tail,this.len=r.len,this.next=r.states}function Le(){this.len=0,this.head=new Po(hl,0,0),this.tail=this.head,this.states=null}var Lh=function(){return Mt.Buffer?function(){return(Le.create=function(){return new pl})()}:function(){return new Le}};Le.create=Lh();Le.alloc=function(e){return new Mt.Array(e)};Mt.Array!==Array&&(Le.alloc=Mt.pool(Le.alloc,Mt.Array.prototype.subarray));Le.prototype._push=function(e,n,t){return this.tail=this.tail.next=new Po(e,n,t),this.len+=n,this};function ml(r,e,n){e[n]=r&255}function U$(r,e,n){for(;r>127;)e[n++]=r&127|128,r>>>=7;e[n]=r}function gl(r,e){this.len=r,this.next=void 0,this.val=e}gl.prototype=Object.create(Po.prototype);gl.prototype.fn=U$;Le.prototype.uint32=function(e){return this.len+=(this.tail=this.tail.next=new gl((e=e>>>0)<128?1:e<16384?2:e<2097152?3:e<268435456?4:5,e)).len,this};Le.prototype.int32=function(e){return e<0?this._push(bl,10,Bi.fromNumber(e)):this.uint32(e)};Le.prototype.sint32=function(e){return this.uint32((e<<1^e>>31)>>>0)};function bl(r,e,n){for(;r.hi;)e[n++]=r.lo&127|128,r.lo=(r.lo>>>7|r.hi<<25)>>>0,r.hi>>>=7;for(;r.lo>127;)e[n++]=r.lo&127|128,r.lo=r.lo>>>7;e[n++]=r.lo}Le.prototype.uint64=function(e){var n=Bi.from(e);return this._push(bl,n.length(),n)};Le.prototype.int64=Le.prototype.uint64;Le.prototype.sint64=function(e){var n=Bi.from(e).zzEncode();return this._push(bl,n.length(),n)};Le.prototype.bool=function(e){return this._push(ml,1,e?1:0)};function fl(r,e,n){e[n]=r&255,e[n+1]=r>>>8&255,e[n+2]=r>>>16&255,e[n+3]=r>>>24}Le.prototype.fixed32=function(e){return this._push(fl,4,e>>>0)};Le.prototype.sfixed32=Le.prototype.fixed32;Le.prototype.fixed64=function(e){var n=Bi.from(e);return this._push(fl,4,n.lo)._push(fl,4,n.hi)};Le.prototype.sfixed64=Le.prototype.fixed64;Le.prototype.float=function(e){return this._push(Mt.float.writeFloatLE,4,e)};Le.prototype.double=function(e){return this._push(Mt.float.writeDoubleLE,8,e)};var F$=Mt.Array.prototype.set?function(e,n,t){n.set(e,t)}:function(e,n,t){for(var o=0;o<e.length;++o)n[t+o]=e[o]};Le.prototype.bytes=function(e){var n=e.length>>>0;if(!n)return this._push(ml,1,0);if(Mt.isString(e)){var t=Le.alloc(n=kh.length(e));kh.decode(e,t,0),e=t}return this.uint32(n)._push(F$,n,e)};Le.prototype.string=function(e){var n=Nh.length(e);return n?this.uint32(n)._push(Nh.write,n,e):this._push(ml,1,0)};Le.prototype.fork=function(){return this.states=new G$(this),this.head=this.tail=new Po(hl,0,0),this.len=0,this};Le.prototype.reset=function(){return this.states?(this.head=this.states.head,this.tail=this.states.tail,this.len=this.states.len,this.states=this.states.next):(this.head=this.tail=new Po(hl,0,0),this.len=0),this};Le.prototype.ldelim=function(){var e=this.head,n=this.tail,t=this.len;return this.reset().uint32(t),t&&(this.tail.next=e.next,this.tail=n,this.len+=t),this};Le.prototype.finish=function(){for(var e=this.head.next,n=this.constructor.alloc(this.len),t=0;e;)e.fn(e.val,n,t),t+=e.len,e=e.next;return n};Le._configure=function(r){pl=r,Le.create=Lh(),pl._configure()}});var Bh=ie((IN,Mh)=>{"use strict";Mh.exports=Rn;var zh=yl();(Rn.prototype=Object.create(zh.prototype)).constructor=Rn;var fr=pr();function Rn(){zh.call(this)}Rn._configure=function(){Rn.alloc=fr._Buffer_allocUnsafe,Rn.writeBytesBuffer=fr.Buffer&&fr.Buffer.prototype instanceof Uint8Array&&fr.Buffer.prototype.set.name==="set"?function(e,n,t){n.set(e,t)}:function(e,n,t){if(e.copy)e.copy(n,t,0,e.length);else for(var o=0;o<e.length;)n[t++]=e[o++]}};Rn.prototype.bytes=function(e){fr.isString(e)&&(e=fr._Buffer_from(e,"base64"));var n=e.length>>>0;return this.uint32(n),n&&this._push(Rn.writeBytesBuffer,n,e),this};function W$(r,e,n){r.length<40?fr.utf8.write(r,e,n):e.utf8Write?e.utf8Write(r,n):e.write(r,n)}Rn.prototype.string=function(e){var n=fr.Buffer.byteLength(e);return this.uint32(n),n&&this._push(W$,n,e),this};Rn._configure()});var vl=ie((SN,Wh)=>{"use strict";Wh.exports=tt;var Bt=pr(),wl,Uh=Bt.LongBits,H$=Bt.utf8;function Kt(r,e){return RangeError("index out of range: "+r.pos+" + "+(e||1)+" > "+r.len)}function tt(r){this.buf=r,this.pos=0,this.len=r.length}var Vh=typeof Uint8Array<"u"?function(e){if(e instanceof Uint8Array||Array.isArray(e))return new tt(e);throw Error("illegal buffer")}:function(e){if(Array.isArray(e))return new tt(e);throw Error("illegal buffer")},Fh=function(){return Bt.Buffer?function(n){return(tt.create=function(o){return Bt.Buffer.isBuffer(o)?new wl(o):Vh(o)})(n)}:Vh};tt.create=Fh();tt.prototype._slice=Bt.Array.prototype.subarray||Bt.Array.prototype.slice;tt.prototype.uint32=(function(){var e=4294967295;return function(){if(e=(this.buf[this.pos]&127)>>>0,this.buf[this.pos++]<128||(e=(e|(this.buf[this.pos]&127)<<7)>>>0,this.buf[this.pos++]<128)||(e=(e|(this.buf[this.pos]&127)<<14)>>>0,this.buf[this.pos++]<128)||(e=(e|(this.buf[this.pos]&127)<<21)>>>0,this.buf[this.pos++]<128)||(e=(e|(this.buf[this.pos]&15)<<28)>>>0,this.buf[this.pos++]<128))return e;if((this.pos+=5)>this.len)throw this.pos=this.len,Kt(this,10);return e}})();tt.prototype.int32=function(){return this.uint32()|0};tt.prototype.sint32=function(){var e=this.uint32();return e>>>1^-(e&1)|0};function _l(){var r=new Uh(0,0),e=0;if(this.len-this.pos>4){for(;e<4;++e)if(r.lo=(r.lo|(this.buf[this.pos]&127)<<e*7)>>>0,this.buf[this.pos++]<128)return r;if(r.lo=(r.lo|(this.buf[this.pos]&127)<<28)>>>0,r.hi=(r.hi|(this.buf[this.pos]&127)>>4)>>>0,this.buf[this.pos++]<128)return r;e=0}else{for(;e<3;++e){if(this.pos>=this.len)throw Kt(this);if(r.lo=(r.lo|(this.buf[this.pos]&127)<<e*7)>>>0,this.buf[this.pos++]<128)return r}return r.lo=(r.lo|(this.buf[this.pos++]&127)<<e*7)>>>0,r}if(this.len-this.pos>4){for(;e<5;++e)if(r.hi=(r.hi|(this.buf[this.pos]&127)<<e*7+3)>>>0,this.buf[this.pos++]<128)return r}else for(;e<5;++e){if(this.pos>=this.len)throw Kt(this);if(r.hi=(r.hi|(this.buf[this.pos]&127)<<e*7+3)>>>0,this.buf[this.pos++]<128)return r}throw Error("invalid varint encoding")}tt.prototype.bool=function(){return this.uint32()!==0};function Vi(r,e){return(r[e-4]|r[e-3]<<8|r[e-2]<<16|r[e-1]<<24)>>>0}tt.prototype.fixed32=function(){if(this.pos+4>this.len)throw Kt(this,4);return Vi(this.buf,this.pos+=4)};tt.prototype.sfixed32=function(){if(this.pos+4>this.len)throw Kt(this,4);return Vi(this.buf,this.pos+=4)|0};function Gh(){if(this.pos+8>this.len)throw Kt(this,8);return new Uh(Vi(this.buf,this.pos+=4),Vi(this.buf,this.pos+=4))}tt.prototype.float=function(){if(this.pos+4>this.len)throw Kt(this,4);var e=Bt.float.readFloatLE(this.buf,this.pos);return this.pos+=4,e};tt.prototype.double=function(){if(this.pos+8>this.len)throw Kt(this,4);var e=Bt.float.readDoubleLE(this.buf,this.pos);return this.pos+=8,e};tt.prototype.bytes=function(){var e=this.uint32(),n=this.pos,t=this.pos+e;if(t>this.len)throw Kt(this,e);if(this.pos+=e,Array.isArray(this.buf))return this.buf.slice(n,t);if(n===t){var o=Bt.Buffer;return o?o.alloc(0):new this.buf.constructor(0)}return this._slice.call(this.buf,n,t)};tt.prototype.string=function(){var e=this.bytes();return H$.read(e,0,e.length)};tt.prototype.skip=function(e){if(typeof e=="number"){if(this.pos+e>this.len)throw Kt(this,e);this.pos+=e}else do if(this.pos>=this.len)throw Kt(this);while(this.buf[this.pos++]&128);return this};tt.recursionLimit=Bt.recursionLimit;tt.prototype.skipType=function(r,e){if(e===void 0&&(e=0),e>tt.recursionLimit)throw Error("maximum nesting depth exceeded");switch(r){case 0:this.skip();break;case 1:this.skip(8);break;case 2:this.skip(this.uint32());break;case 3:for(;(r=this.uint32()&7)!==4;)this.skipType(r,e+1);break;case 5:this.skip(4);break;default:throw Error("invalid wire type "+r+" at offset "+this.pos)}return this};tt._configure=function(r){wl=r,tt.create=Fh(),wl._configure();var e=Bt.Long?"toLong":"toNumber";Bt.merge(tt.prototype,{int64:function(){return _l.call(this)[e](!1)},uint64:function(){return _l.call(this)[e](!0)},sint64:function(){return _l.call(this).zzDecode()[e](!1)},fixed64:function(){return Gh.call(this)[e](!0)},sfixed64:function(){return Gh.call(this)[e](!1)}})}});var Kh=ie(($N,jh)=>{"use strict";jh.exports=Pr;var qh=vl();(Pr.prototype=Object.create(qh.prototype)).constructor=Pr;var Hh=pr();function Pr(r){qh.call(this,r)}Pr._configure=function(){Hh.Buffer&&(Pr.prototype._slice=Hh.Buffer.prototype.slice)};Pr.prototype.string=function(){var e=this.uint32();return this.buf.utf8Slice?this.buf.utf8Slice(this.pos,this.pos=Math.min(this.pos+e,this.len)):this.buf.toString("utf-8",this.pos,this.pos=Math.min(this.pos+e,this.len))};Pr._configure()});var Zh=ie((AN,Xh)=>{"use strict";Xh.exports=Eo;var xl=pr();(Eo.prototype=Object.create(xl.EventEmitter.prototype)).constructor=Eo;function Eo(r,e,n){if(typeof r!="function")throw TypeError("rpcImpl must be a function");xl.EventEmitter.call(this),this.rpcImpl=r,this.requestDelimited=!!e,this.responseDelimited=!!n}Eo.prototype.rpcCall=function r(e,n,t,o,i){if(!o)throw TypeError("request must be specified");var a=this;if(!i)return xl.asPromise(r,a,e,n,t,o);if(!a.rpcImpl){setTimeout(function(){i(Error("already ended"))},0);return}try{return a.rpcImpl(e,n[a.requestDelimited?"encodeDelimited":"encode"](o).finish(),function(u,l){if(u)return a.emit("error",u,e),i(u);if(l===null){a.end(!0);return}if(!(l instanceof t))try{l=t[a.responseDelimited?"decodeDelimited":"decode"](l)}catch(d){return a.emit("error",d,e),i(d)}return a.emit("data",l,e),i(null,l)})}catch(s){a.emit("error",s,e),setTimeout(function(){i(s)},0);return}};Eo.prototype.end=function(e){return this.rpcImpl&&(e||this.rpcImpl(null,null,null),this.rpcImpl=null,this.emit("end").off()),this}});var Yh=ie(Jh=>{"use strict";var q$=Jh;q$.Service=Zh()});var em=ie((PN,Qh)=>{"use strict";Qh.exports={}});var rm=ie(nm=>{"use strict";var xt=nm;xt.build="minimal";xt.Writer=yl();xt.BufferWriter=Bh();xt.Reader=vl();xt.BufferReader=Kh();xt.util=pr();xt.rpc=Yh();xt.roots=em();xt.configure=tm;function tm(){xt.util._configure(),xt.Writer._configure(xt.BufferWriter),xt.Reader._configure(xt.BufferReader)}tm()});var im=ie((CN,om)=>{"use strict";om.exports=rm()});var Qr=ie((DN,am)=>{"use strict";var Xe=im(),Q=Xe.Reader,rt=Xe.Writer,C=Xe.util,A=Xe.roots.default||(Xe.roots.default={});A.onnx=(function(){var r={};return r.Version=(function(){var e={},n=Object.create(e);return n[e[0]="_START_VERSION"]=0,n[e[1]="IR_VERSION_2017_10_10"]=1,n[e[2]="IR_VERSION_2017_10_30"]=2,n[e[3]="IR_VERSION_2017_11_3"]=3,n[e[4]="IR_VERSION_2019_1_22"]=4,n[e[5]="IR_VERSION_2019_3_18"]=5,n[e[6]="IR_VERSION_2019_9_19"]=6,n[e[7]="IR_VERSION_2020_5_8"]=7,n[e[8]="IR_VERSION_2021_7_30"]=8,n[e[9]="IR_VERSION"]=9,n})(),r.AttributeProto=(function(){function e(n){if(this.floats=[],this.ints=[],this.strings=[],this.tensors=[],this.graphs=[],this.sparseTensors=[],this.typeProtos=[],n)for(var t=Object.keys(n),o=0;o<t.length;++o)n[t[o]]!=null&&(this[t[o]]=n[t[o]])}return e.prototype.name="",e.prototype.refAttrName="",e.prototype.docString="",e.prototype.type=0,e.prototype.f=0,e.prototype.i=C.Long?C.Long.fromBits(0,0,!1):0,e.prototype.s=C.newBuffer([]),e.prototype.t=null,e.prototype.g=null,e.prototype.sparseTensor=null,e.prototype.tp=null,e.prototype.floats=C.emptyArray,e.prototype.ints=C.emptyArray,e.prototype.strings=C.emptyArray,e.prototype.tensors=C.emptyArray,e.prototype.graphs=C.emptyArray,e.prototype.sparseTensors=C.emptyArray,e.prototype.typeProtos=C.emptyArray,e.create=function(t){return new e(t)},e.encode=function(t,o){if(o||(o=rt.create()),t.name!=null&&Object.hasOwnProperty.call(t,"name")&&o.uint32(10).string(t.name),t.f!=null&&Object.hasOwnProperty.call(t,"f")&&o.uint32(21).float(t.f),t.i!=null&&Object.hasOwnProperty.call(t,"i")&&o.uint32(24).int64(t.i),t.s!=null&&Object.hasOwnProperty.call(t,"s")&&o.uint32(34).bytes(t.s),t.t!=null&&Object.hasOwnProperty.call(t,"t")&&A.onnx.TensorProto.encode(t.t,o.uint32(42).fork()).ldelim(),t.g!=null&&Object.hasOwnProperty.call(t,"g")&&A.onnx.GraphProto.encode(t.g,o.uint32(50).fork()).ldelim(),t.floats!=null&&t.floats.length){o.uint32(58).fork();for(var i=0;i<t.floats.length;++i)o.float(t.floats[i]);o.ldelim()}if(t.ints!=null&&t.ints.length){o.uint32(66).fork();for(var i=0;i<t.ints.length;++i)o.int64(t.ints[i]);o.ldelim()}if(t.strings!=null&&t.strings.length)for(var i=0;i<t.strings.length;++i)o.uint32(74).bytes(t.strings[i]);if(t.tensors!=null&&t.tensors.length)for(var i=0;i<t.tensors.length;++i)A.onnx.TensorProto.encode(t.tensors[i],o.uint32(82).fork()).ldelim();if(t.graphs!=null&&t.graphs.length)for(var i=0;i<t.graphs.length;++i)A.onnx.GraphProto.encode(t.graphs[i],o.uint32(90).fork()).ldelim();if(t.docString!=null&&Object.hasOwnProperty.call(t,"docString")&&o.uint32(106).string(t.docString),t.tp!=null&&Object.hasOwnProperty.call(t,"tp")&&A.onnx.TypeProto.encode(t.tp,o.uint32(114).fork()).ldelim(),t.typeProtos!=null&&t.typeProtos.length)for(var i=0;i<t.typeProtos.length;++i)A.onnx.TypeProto.encode(t.typeProtos[i],o.uint32(122).fork()).ldelim();if(t.type!=null&&Object.hasOwnProperty.call(t,"type")&&o.uint32(160).int32(t.type),t.refAttrName!=null&&Object.hasOwnProperty.call(t,"refAttrName")&&o.uint32(170).string(t.refAttrName),t.sparseTensor!=null&&Object.hasOwnProperty.call(t,"sparseTensor")&&A.onnx.SparseTensorProto.encode(t.sparseTensor,o.uint32(178).fork()).ldelim(),t.sparseTensors!=null&&t.sparseTensors.length)for(var i=0;i<t.sparseTensors.length;++i)A.onnx.SparseTensorProto.encode(t.sparseTensors[i],o.uint32(186).fork()).ldelim();return o},e.encodeDelimited=function(t,o){return this.encode(t,o).ldelim()},e.decode=function(t,o){t instanceof Q||(t=Q.create(t));for(var i=o===void 0?t.len:t.pos+o,a=new A.onnx.AttributeProto;t.pos<i;){var s=t.uint32();switch(s>>>3){case 1:{a.name=t.string();break}case 21:{a.refAttrName=t.string();break}case 13:{a.docString=t.string();break}case 20:{a.type=t.int32();break}case 2:{a.f=t.float();break}case 3:{a.i=t.int64();break}case 4:{a.s=t.bytes();break}case 5:{a.t=A.onnx.TensorProto.decode(t,t.uint32());break}case 6:{a.g=A.onnx.GraphProto.decode(t,t.uint32());break}case 22:{a.sparseTensor=A.onnx.SparseTensorProto.decode(t,t.uint32());break}case 14:{a.tp=A.onnx.TypeProto.decode(t,t.uint32());break}case 7:{if(a.floats&&a.floats.length||(a.floats=[]),(s&7)===2)for(var u=t.uint32()+t.pos;t.pos<u;)a.floats.push(t.float());else a.floats.push(t.float());break}case 8:{if(a.ints&&a.ints.length||(a.ints=[]),(s&7)===2)for(var u=t.uint32()+t.pos;t.pos<u;)a.ints.push(t.int64());else a.ints.push(t.int64());break}case 9:{a.strings&&a.strings.length||(a.strings=[]),a.strings.push(t.bytes());break}case 10:{a.tensors&&a.tensors.length||(a.tensors=[]),a.tensors.push(A.onnx.TensorProto.decode(t,t.uint32()));break}case 11:{a.graphs&&a.graphs.length||(a.graphs=[]),a.graphs.push(A.onnx.GraphProto.decode(t,t.uint32()));break}case 23:{a.sparseTensors&&a.sparseTensors.length||(a.sparseTensors=[]),a.sparseTensors.push(A.onnx.SparseTensorProto.decode(t,t.uint32()));break}case 15:{a.typeProtos&&a.typeProtos.length||(a.typeProtos=[]),a.typeProtos.push(A.onnx.TypeProto.decode(t,t.uint32()));break}default:t.skipType(s&7);break}}return a},e.decodeDelimited=function(t){return t instanceof Q||(t=new Q(t)),this.decode(t,t.uint32())},e.verify=function(t){if(typeof t!="object"||t===null)return"object expected";if(t.name!=null&&t.hasOwnProperty("name")&&!C.isString(t.name))return"name: string expected";if(t.refAttrName!=null&&t.hasOwnProperty("refAttrName")&&!C.isString(t.refAttrName))return"refAttrName: string expected";if(t.docString!=null&&t.hasOwnProperty("docString")&&!C.isString(t.docString))return"docString: string expected";if(t.type!=null&&t.hasOwnProperty("type"))switch(t.type){default:return"type: enum value expected";case 0:case 1:case 2:case 3:case 4:case 5:case 11:case 13:case 6:case 7:case 8:case 9:case 10:case 12:case 14:break}if(t.f!=null&&t.hasOwnProperty("f")&&typeof t.f!="number")return"f: number expected";if(t.i!=null&&t.hasOwnProperty("i")&&!C.isInteger(t.i)&&!(t.i&&C.isInteger(t.i.low)&&C.isInteger(t.i.high)))return"i: integer|Long expected";if(t.s!=null&&t.hasOwnProperty("s")&&!(t.s&&typeof t.s.length=="number"||C.isString(t.s)))return"s: buffer expected";if(t.t!=null&&t.hasOwnProperty("t")){var o=A.onnx.TensorProto.verify(t.t);if(o)return"t."+o}if(t.g!=null&&t.hasOwnProperty("g")){var o=A.onnx.GraphProto.verify(t.g);if(o)return"g."+o}if(t.sparseTensor!=null&&t.hasOwnProperty("sparseTensor")){var o=A.onnx.SparseTensorProto.verify(t.sparseTensor);if(o)return"sparseTensor."+o}if(t.tp!=null&&t.hasOwnProperty("tp")){var o=A.onnx.TypeProto.verify(t.tp);if(o)return"tp."+o}if(t.floats!=null&&t.hasOwnProperty("floats")){if(!Array.isArray(t.floats))return"floats: array expected";for(var i=0;i<t.floats.length;++i)if(typeof t.floats[i]!="number")return"floats: number[] expected"}if(t.ints!=null&&t.hasOwnProperty("ints")){if(!Array.isArray(t.ints))return"ints: array expected";for(var i=0;i<t.ints.length;++i)if(!C.isInteger(t.ints[i])&&!(t.ints[i]&&C.isInteger(t.ints[i].low)&&C.isInteger(t.ints[i].high)))return"ints: integer|Long[] expected"}if(t.strings!=null&&t.hasOwnProperty("strings")){if(!Array.isArray(t.strings))return"strings: array expected";for(var i=0;i<t.strings.length;++i)if(!(t.strings[i]&&typeof t.strings[i].length=="number"||C.isString(t.strings[i])))return"strings: buffer[] expected"}if(t.tensors!=null&&t.hasOwnProperty("tensors")){if(!Array.isArray(t.tensors))return"tensors: array expected";for(var i=0;i<t.tensors.length;++i){var o=A.onnx.TensorProto.verify(t.tensors[i]);if(o)return"tensors."+o}}if(t.graphs!=null&&t.hasOwnProperty("graphs")){if(!Array.isArray(t.graphs))return"graphs: array expected";for(var i=0;i<t.graphs.length;++i){var o=A.onnx.GraphProto.verify(t.graphs[i]);if(o)return"graphs."+o}}if(t.sparseTensors!=null&&t.hasOwnProperty("sparseTensors")){if(!Array.isArray(t.sparseTensors))return"sparseTensors: array expected";for(var i=0;i<t.sparseTensors.length;++i){var o=A.onnx.SparseTensorProto.verify(t.sparseTensors[i]);if(o)return"sparseTensors."+o}}if(t.typeProtos!=null&&t.hasOwnProperty("typeProtos")){if(!Array.isArray(t.typeProtos))return"typeProtos: array expected";for(var i=0;i<t.typeProtos.length;++i){var o=A.onnx.TypeProto.verify(t.typeProtos[i]);if(o)return"typeProtos."+o}}return null},e.fromObject=function(t){if(t instanceof A.onnx.AttributeProto)return t;var o=new A.onnx.AttributeProto;switch(t.name!=null&&(o.name=String(t.name)),t.refAttrName!=null&&(o.refAttrName=String(t.refAttrName)),t.docString!=null&&(o.docString=String(t.docString)),t.type){default:if(typeof t.type=="number"){o.type=t.type;break}break;case"UNDEFINED":case 0:o.type=0;break;case"FLOAT":case 1:o.type=1;break;case"INT":case 2:o.type=2;break;case"STRING":case 3:o.type=3;break;case"TENSOR":case 4:o.type=4;break;case"GRAPH":case 5:o.type=5;break;case"SPARSE_TENSOR":case 11:o.type=11;break;case"TYPE_PROTO":case 13:o.type=13;break;case"FLOATS":case 6:o.type=6;break;case"INTS":case 7:o.type=7;break;case"STRINGS":case 8:o.type=8;break;case"TENSORS":case 9:o.type=9;break;case"GRAPHS":case 10:o.type=10;break;case"SPARSE_TENSORS":case 12:o.type=12;break;case"TYPE_PROTOS":case 14:o.type=14;break}if(t.f!=null&&(o.f=Number(t.f)),t.i!=null&&(C.Long?(o.i=C.Long.fromValue(t.i)).unsigned=!1:typeof t.i=="string"?o.i=parseInt(t.i,10):typeof t.i=="number"?o.i=t.i:typeof t.i=="object"&&(o.i=new C.LongBits(t.i.low>>>0,t.i.high>>>0).toNumber())),t.s!=null&&(typeof t.s=="string"?C.base64.decode(t.s,o.s=C.newBuffer(C.base64.length(t.s)),0):t.s.length>=0&&(o.s=t.s)),t.t!=null){if(typeof t.t!="object")throw TypeError(".onnx.AttributeProto.t: object expected");o.t=A.onnx.TensorProto.fromObject(t.t)}if(t.g!=null){if(typeof t.g!="object")throw TypeError(".onnx.AttributeProto.g: object expected");o.g=A.onnx.GraphProto.fromObject(t.g)}if(t.sparseTensor!=null){if(typeof t.sparseTensor!="object")throw TypeError(".onnx.AttributeProto.sparseTensor: object expected");o.sparseTensor=A.onnx.SparseTensorProto.fromObject(t.sparseTensor)}if(t.tp!=null){if(typeof t.tp!="object")throw TypeError(".onnx.AttributeProto.tp: object expected");o.tp=A.onnx.TypeProto.fromObject(t.tp)}if(t.floats){if(!Array.isArray(t.floats))throw TypeError(".onnx.AttributeProto.floats: array expected");o.floats=[];for(var i=0;i<t.floats.length;++i)o.floats[i]=Number(t.floats[i])}if(t.ints){if(!Array.isArray(t.ints))throw TypeError(".onnx.AttributeProto.ints: array expected");o.ints=[];for(var i=0;i<t.ints.length;++i)C.Long?(o.ints[i]=C.Long.fromValue(t.ints[i])).unsigned=!1:typeof t.ints[i]=="string"?o.ints[i]=parseInt(t.ints[i],10):typeof t.ints[i]=="number"?o.ints[i]=t.ints[i]:typeof t.ints[i]=="object"&&(o.ints[i]=new C.LongBits(t.ints[i].low>>>0,t.ints[i].high>>>0).toNumber())}if(t.strings){if(!Array.isArray(t.strings))throw TypeError(".onnx.AttributeProto.strings: array expected");o.strings=[];for(var i=0;i<t.strings.length;++i)typeof t.strings[i]=="string"?C.base64.decode(t.strings[i],o.strings[i]=C.newBuffer(C.base64.length(t.strings[i])),0):t.strings[i].length>=0&&(o.strings[i]=t.strings[i])}if(t.tensors){if(!Array.isArray(t.tensors))throw TypeError(".onnx.AttributeProto.tensors: array expected");o.tensors=[];for(var i=0;i<t.tensors.length;++i){if(typeof t.tensors[i]!="object")throw TypeError(".onnx.AttributeProto.tensors: object expected");o.tensors[i]=A.onnx.TensorProto.fromObject(t.tensors[i])}}if(t.graphs){if(!Array.isArray(t.graphs))throw TypeError(".onnx.AttributeProto.graphs: array expected");o.graphs=[];for(var i=0;i<t.graphs.length;++i){if(typeof t.graphs[i]!="object")throw TypeError(".onnx.AttributeProto.graphs: object expected");o.graphs[i]=A.onnx.GraphProto.fromObject(t.graphs[i])}}if(t.sparseTensors){if(!Array.isArray(t.sparseTensors))throw TypeError(".onnx.AttributeProto.sparseTensors: array expected");o.sparseTensors=[];for(var i=0;i<t.sparseTensors.length;++i){if(typeof t.sparseTensors[i]!="object")throw TypeError(".onnx.AttributeProto.sparseTensors: object expected");o.sparseTensors[i]=A.onnx.SparseTensorProto.fromObject(t.sparseTensors[i])}}if(t.typeProtos){if(!Array.isArray(t.typeProtos))throw TypeError(".onnx.AttributeProto.typeProtos: array expected");o.typeProtos=[];for(var i=0;i<t.typeProtos.length;++i){if(typeof t.typeProtos[i]!="object")throw TypeError(".onnx.AttributeProto.typeProtos: object expected");o.typeProtos[i]=A.onnx.TypeProto.fromObject(t.typeProtos[i])}}return o},e.toObject=function(t,o){o||(o={});var i={};if((o.arrays||o.defaults)&&(i.floats=[],i.ints=[],i.strings=[],i.tensors=[],i.graphs=[],i.typeProtos=[],i.sparseTensors=[]),o.defaults){if(i.name="",i.f=0,C.Long){var a=new C.Long(0,0,!1);i.i=o.longs===String?a.toString():o.longs===Number?a.toNumber():a}else i.i=o.longs===String?"0":0;o.bytes===String?i.s="":(i.s=[],o.bytes!==Array&&(i.s=C.newBuffer(i.s))),i.t=null,i.g=null,i.docString="",i.tp=null,i.type=o.enums===String?"UNDEFINED":0,i.refAttrName="",i.sparseTensor=null}if(t.name!=null&&t.hasOwnProperty("name")&&(i.name=t.name),t.f!=null&&t.hasOwnProperty("f")&&(i.f=o.json&&!isFinite(t.f)?String(t.f):t.f),t.i!=null&&t.hasOwnProperty("i")&&(typeof t.i=="number"?i.i=o.longs===String?String(t.i):t.i:i.i=o.longs===String?C.Long.prototype.toString.call(t.i):o.longs===Number?new C.LongBits(t.i.low>>>0,t.i.high>>>0).toNumber():t.i),t.s!=null&&t.hasOwnProperty("s")&&(i.s=o.bytes===String?C.base64.encode(t.s,0,t.s.length):o.bytes===Array?Array.prototype.slice.call(t.s):t.s),t.t!=null&&t.hasOwnProperty("t")&&(i.t=A.onnx.TensorProto.toObject(t.t,o)),t.g!=null&&t.hasOwnProperty("g")&&(i.g=A.onnx.GraphProto.toObject(t.g,o)),t.floats&&t.floats.length){i.floats=[];for(var s=0;s<t.floats.length;++s)i.floats[s]=o.json&&!isFinite(t.floats[s])?String(t.floats[s]):t.floats[s]}if(t.ints&&t.ints.length){i.ints=[];for(var s=0;s<t.ints.length;++s)typeof t.ints[s]=="number"?i.ints[s]=o.longs===String?String(t.ints[s]):t.ints[s]:i.ints[s]=o.longs===String?C.Long.prototype.toString.call(t.ints[s]):o.longs===Number?new C.LongBits(t.ints[s].low>>>0,t.ints[s].high>>>0).toNumber():t.ints[s]}if(t.strings&&t.strings.length){i.strings=[];for(var s=0;s<t.strings.length;++s)i.strings[s]=o.bytes===String?C.base64.encode(t.strings[s],0,t.strings[s].length):o.bytes===Array?Array.prototype.slice.call(t.strings[s]):t.strings[s]}if(t.tensors&&t.tensors.length){i.tensors=[];for(var s=0;s<t.tensors.length;++s)i.tensors[s]=A.onnx.TensorProto.toObject(t.tensors[s],o)}if(t.graphs&&t.graphs.length){i.graphs=[];for(var s=0;s<t.graphs.length;++s)i.graphs[s]=A.onnx.GraphProto.toObject(t.graphs[s],o)}if(t.docString!=null&&t.hasOwnProperty("docString")&&(i.docString=t.docString),t.tp!=null&&t.hasOwnProperty("tp")&&(i.tp=A.onnx.TypeProto.toObject(t.tp,o)),t.typeProtos&&t.typeProtos.length){i.typeProtos=[];for(var s=0;s<t.typeProtos.length;++s)i.typeProtos[s]=A.onnx.TypeProto.toObject(t.typeProtos[s],o)}if(t.type!=null&&t.hasOwnProperty("type")&&(i.type=o.enums===String?A.onnx.AttributeProto.AttributeType[t.type]===void 0?t.type:A.onnx.AttributeProto.AttributeType[t.type]:t.type),t.refAttrName!=null&&t.hasOwnProperty("refAttrName")&&(i.refAttrName=t.refAttrName),t.sparseTensor!=null&&t.hasOwnProperty("sparseTensor")&&(i.sparseTensor=A.onnx.SparseTensorProto.toObject(t.sparseTensor,o)),t.sparseTensors&&t.sparseTensors.length){i.sparseTensors=[];for(var s=0;s<t.sparseTensors.length;++s)i.sparseTensors[s]=A.onnx.SparseTensorProto.toObject(t.sparseTensors[s],o)}return i},e.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},e.getTypeUrl=function(t){return t===void 0&&(t="type.googleapis.com"),t+"/onnx.AttributeProto"},e.AttributeType=(function(){var n={},t=Object.create(n);return t[n[0]="UNDEFINED"]=0,t[n[1]="FLOAT"]=1,t[n[2]="INT"]=2,t[n[3]="STRING"]=3,t[n[4]="TENSOR"]=4,t[n[5]="GRAPH"]=5,t[n[11]="SPARSE_TENSOR"]=11,t[n[13]="TYPE_PROTO"]=13,t[n[6]="FLOATS"]=6,t[n[7]="INTS"]=7,t[n[8]="STRINGS"]=8,t[n[9]="TENSORS"]=9,t[n[10]="GRAPHS"]=10,t[n[12]="SPARSE_TENSORS"]=12,t[n[14]="TYPE_PROTOS"]=14,t})(),e})(),r.ValueInfoProto=(function(){function e(n){if(n)for(var t=Object.keys(n),o=0;o<t.length;++o)n[t[o]]!=null&&(this[t[o]]=n[t[o]])}return e.prototype.name="",e.prototype.type=null,e.prototype.docString="",e.create=function(t){return new e(t)},e.encode=function(t,o){return o||(o=rt.create()),t.name!=null&&Object.hasOwnProperty.call(t,"name")&&o.uint32(10).string(t.name),t.type!=null&&Object.hasOwnProperty.call(t,"type")&&A.onnx.TypeProto.encode(t.type,o.uint32(18).fork()).ldelim(),t.docString!=null&&Object.hasOwnProperty.call(t,"docString")&&o.uint32(26).string(t.docString),o},e.encodeDelimited=function(t,o){return this.encode(t,o).ldelim()},e.decode=function(t,o){t instanceof Q||(t=Q.create(t));for(var i=o===void 0?t.len:t.pos+o,a=new A.onnx.ValueInfoProto;t.pos<i;){var s=t.uint32();switch(s>>>3){case 1:{a.name=t.string();break}case 2:{a.type=A.onnx.TypeProto.decode(t,t.uint32());break}case 3:{a.docString=t.string();break}default:t.skipType(s&7);break}}return a},e.decodeDelimited=function(t){return t instanceof Q||(t=new Q(t)),this.decode(t,t.uint32())},e.verify=function(t){if(typeof t!="object"||t===null)return"object expected";if(t.name!=null&&t.hasOwnProperty("name")&&!C.isString(t.name))return"name: string expected";if(t.type!=null&&t.hasOwnProperty("type")){var o=A.onnx.TypeProto.verify(t.type);if(o)return"type."+o}return t.docString!=null&&t.hasOwnProperty("docString")&&!C.isString(t.docString)?"docString: string expected":null},e.fromObject=function(t){if(t instanceof A.onnx.ValueInfoProto)return t;var o=new A.onnx.ValueInfoProto;if(t.name!=null&&(o.name=String(t.name)),t.type!=null){if(typeof t.type!="object")throw TypeError(".onnx.ValueInfoProto.type: object expected");o.type=A.onnx.TypeProto.fromObject(t.type)}return t.docString!=null&&(o.docString=String(t.docString)),o},e.toObject=function(t,o){o||(o={});var i={};return o.defaults&&(i.name="",i.type=null,i.docString=""),t.name!=null&&t.hasOwnProperty("name")&&(i.name=t.name),t.type!=null&&t.hasOwnProperty("type")&&(i.type=A.onnx.TypeProto.toObject(t.type,o)),t.docString!=null&&t.hasOwnProperty("docString")&&(i.docString=t.docString),i},e.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},e.getTypeUrl=function(t){return t===void 0&&(t="type.googleapis.com"),t+"/onnx.ValueInfoProto"},e})(),r.NodeProto=(function(){function e(n){if(this.input=[],this.output=[],this.attribute=[],n)for(var t=Object.keys(n),o=0;o<t.length;++o)n[t[o]]!=null&&(this[t[o]]=n[t[o]])}return e.prototype.input=C.emptyArray,e.prototype.output=C.emptyArray,e.prototype.name="",e.prototype.opType="",e.prototype.domain="",e.prototype.attribute=C.emptyArray,e.prototype.docString="",e.create=function(t){return new e(t)},e.encode=function(t,o){if(o||(o=rt.create()),t.input!=null&&t.input.length)for(var i=0;i<t.input.length;++i)o.uint32(10).string(t.input[i]);if(t.output!=null&&t.output.length)for(var i=0;i<t.output.length;++i)o.uint32(18).string(t.output[i]);if(t.name!=null&&Object.hasOwnProperty.call(t,"name")&&o.uint32(26).string(t.name),t.opType!=null&&Object.hasOwnProperty.call(t,"opType")&&o.uint32(34).string(t.opType),t.attribute!=null&&t.attribute.length)for(var i=0;i<t.attribute.length;++i)A.onnx.AttributeProto.encode(t.attribute[i],o.uint32(42).fork()).ldelim();return t.docString!=null&&Object.hasOwnProperty.call(t,"docString")&&o.uint32(50).string(t.docString),t.domain!=null&&Object.hasOwnProperty.call(t,"domain")&&o.uint32(58).string(t.domain),o},e.encodeDelimited=function(t,o){return this.encode(t,o).ldelim()},e.decode=function(t,o){t instanceof Q||(t=Q.create(t));for(var i=o===void 0?t.len:t.pos+o,a=new A.onnx.NodeProto;t.pos<i;){var s=t.uint32();switch(s>>>3){case 1:{a.input&&a.input.length||(a.input=[]),a.input.push(t.string());break}case 2:{a.output&&a.output.length||(a.output=[]),a.output.push(t.string());break}case 3:{a.name=t.string();break}case 4:{a.opType=t.string();break}case 7:{a.domain=t.string();break}case 5:{a.attribute&&a.attribute.length||(a.attribute=[]),a.attribute.push(A.onnx.AttributeProto.decode(t,t.uint32()));break}case 6:{a.docString=t.string();break}default:t.skipType(s&7);break}}return a},e.decodeDelimited=function(t){return t instanceof Q||(t=new Q(t)),this.decode(t,t.uint32())},e.verify=function(t){if(typeof t!="object"||t===null)return"object expected";if(t.input!=null&&t.hasOwnProperty("input")){if(!Array.isArray(t.input))return"input: array expected";for(var o=0;o<t.input.length;++o)if(!C.isString(t.input[o]))return"input: string[] expected"}if(t.output!=null&&t.hasOwnProperty("output")){if(!Array.isArray(t.output))return"output: array expected";for(var o=0;o<t.output.length;++o)if(!C.isString(t.output[o]))return"output: string[] expected"}if(t.name!=null&&t.hasOwnProperty("name")&&!C.isString(t.name))return"name: string expected";if(t.opType!=null&&t.hasOwnProperty("opType")&&!C.isString(t.opType))return"opType: string expected";if(t.domain!=null&&t.hasOwnProperty("domain")&&!C.isString(t.domain))return"domain: string expected";if(t.attribute!=null&&t.hasOwnProperty("attribute")){if(!Array.isArray(t.attribute))return"attribute: array expected";for(var o=0;o<t.attribute.length;++o){var i=A.onnx.AttributeProto.verify(t.attribute[o]);if(i)return"attribute."+i}}return t.docString!=null&&t.hasOwnProperty("docString")&&!C.isString(t.docString)?"docString: string expected":null},e.fromObject=function(t){if(t instanceof A.onnx.NodeProto)return t;var o=new A.onnx.NodeProto;if(t.input){if(!Array.isArray(t.input))throw TypeError(".onnx.NodeProto.input: array expected");o.input=[];for(var i=0;i<t.input.length;++i)o.input[i]=String(t.input[i])}if(t.output){if(!Array.isArray(t.output))throw TypeError(".onnx.NodeProto.output: array expected");o.output=[];for(var i=0;i<t.output.length;++i)o.output[i]=String(t.output[i])}if(t.name!=null&&(o.name=String(t.name)),t.opType!=null&&(o.opType=String(t.opType)),t.domain!=null&&(o.domain=String(t.domain)),t.attribute){if(!Array.isArray(t.attribute))throw TypeError(".onnx.NodeProto.attribute: array expected");o.attribute=[];for(var i=0;i<t.attribute.length;++i){if(typeof t.attribute[i]!="object")throw TypeError(".onnx.NodeProto.attribute: object expected");o.attribute[i]=A.onnx.AttributeProto.fromObject(t.attribute[i])}}return t.docString!=null&&(o.docString=String(t.docString)),o},e.toObject=function(t,o){o||(o={});var i={};if((o.arrays||o.defaults)&&(i.input=[],i.output=[],i.attribute=[]),o.defaults&&(i.name="",i.opType="",i.docString="",i.domain=""),t.input&&t.input.length){i.input=[];for(var a=0;a<t.input.length;++a)i.input[a]=t.input[a]}if(t.output&&t.output.length){i.output=[];for(var a=0;a<t.output.length;++a)i.output[a]=t.output[a]}if(t.name!=null&&t.hasOwnProperty("name")&&(i.name=t.name),t.opType!=null&&t.hasOwnProperty("opType")&&(i.opType=t.opType),t.attribute&&t.attribute.length){i.attribute=[];for(var a=0;a<t.attribute.length;++a)i.attribute[a]=A.onnx.AttributeProto.toObject(t.attribute[a],o)}return t.docString!=null&&t.hasOwnProperty("docString")&&(i.docString=t.docString),t.domain!=null&&t.hasOwnProperty("domain")&&(i.domain=t.domain),i},e.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},e.getTypeUrl=function(t){return t===void 0&&(t="type.googleapis.com"),t+"/onnx.NodeProto"},e})(),r.TrainingInfoProto=(function(){function e(n){if(this.initializationBinding=[],this.updateBinding=[],n)for(var t=Object.keys(n),o=0;o<t.length;++o)n[t[o]]!=null&&(this[t[o]]=n[t[o]])}return e.prototype.initialization=null,e.prototype.algorithm=null,e.prototype.initializationBinding=C.emptyArray,e.prototype.updateBinding=C.emptyArray,e.create=function(t){return new e(t)},e.encode=function(t,o){if(o||(o=rt.create()),t.initialization!=null&&Object.hasOwnProperty.call(t,"initialization")&&A.onnx.GraphProto.encode(t.initialization,o.uint32(10).fork()).ldelim(),t.algorithm!=null&&Object.hasOwnProperty.call(t,"algorithm")&&A.onnx.GraphProto.encode(t.algorithm,o.uint32(18).fork()).ldelim(),t.initializationBinding!=null&&t.initializationBinding.length)for(var i=0;i<t.initializationBinding.length;++i)A.onnx.StringStringEntryProto.encode(t.initializationBinding[i],o.uint32(26).fork()).ldelim();if(t.updateBinding!=null&&t.updateBinding.length)for(var i=0;i<t.updateBinding.length;++i)A.onnx.StringStringEntryProto.encode(t.updateBinding[i],o.uint32(34).fork()).ldelim();return o},e.encodeDelimited=function(t,o){return this.encode(t,o).ldelim()},e.decode=function(t,o){t instanceof Q||(t=Q.create(t));for(var i=o===void 0?t.len:t.pos+o,a=new A.onnx.TrainingInfoProto;t.pos<i;){var s=t.uint32();switch(s>>>3){case 1:{a.initialization=A.onnx.GraphProto.decode(t,t.uint32());break}case 2:{a.algorithm=A.onnx.GraphProto.decode(t,t.uint32());break}case 3:{a.initializationBinding&&a.initializationBinding.length||(a.initializationBinding=[]),a.initializationBinding.push(A.onnx.StringStringEntryProto.decode(t,t.uint32()));break}case 4:{a.updateBinding&&a.updateBinding.length||(a.updateBinding=[]),a.updateBinding.push(A.onnx.StringStringEntryProto.decode(t,t.uint32()));break}default:t.skipType(s&7);break}}return a},e.decodeDelimited=function(t){return t instanceof Q||(t=new Q(t)),this.decode(t,t.uint32())},e.verify=function(t){if(typeof t!="object"||t===null)return"object expected";if(t.initialization!=null&&t.hasOwnProperty("initialization")){var o=A.onnx.GraphProto.verify(t.initialization);if(o)return"initialization."+o}if(t.algorithm!=null&&t.hasOwnProperty("algorithm")){var o=A.onnx.GraphProto.verify(t.algorithm);if(o)return"algorithm."+o}if(t.initializationBinding!=null&&t.hasOwnProperty("initializationBinding")){if(!Array.isArray(t.initializationBinding))return"initializationBinding: array expected";for(var i=0;i<t.initializationBinding.length;++i){var o=A.onnx.StringStringEntryProto.verify(t.initializationBinding[i]);if(o)return"initializationBinding."+o}}if(t.updateBinding!=null&&t.hasOwnProperty("updateBinding")){if(!Array.isArray(t.updateBinding))return"updateBinding: array expected";for(var i=0;i<t.updateBinding.length;++i){var o=A.onnx.StringStringEntryProto.verify(t.updateBinding[i]);if(o)return"updateBinding."+o}}return null},e.fromObject=function(t){if(t instanceof A.onnx.TrainingInfoProto)return t;var o=new A.onnx.TrainingInfoProto;if(t.initialization!=null){if(typeof t.initialization!="object")throw TypeError(".onnx.TrainingInfoProto.initialization: object expected");o.initialization=A.onnx.GraphProto.fromObject(t.initialization)}if(t.algorithm!=null){if(typeof t.algorithm!="object")throw TypeError(".onnx.TrainingInfoProto.algorithm: object expected");o.algorithm=A.onnx.GraphProto.fromObject(t.algorithm)}if(t.initializationBinding){if(!Array.isArray(t.initializationBinding))throw TypeError(".onnx.TrainingInfoProto.initializationBinding: array expected");o.initializationBinding=[];for(var i=0;i<t.initializationBinding.length;++i){if(typeof t.initializationBinding[i]!="object")throw TypeError(".onnx.TrainingInfoProto.initializationBinding: object expected");o.initializationBinding[i]=A.onnx.StringStringEntryProto.fromObject(t.initializationBinding[i])}}if(t.updateBinding){if(!Array.isArray(t.updateBinding))throw TypeError(".onnx.TrainingInfoProto.updateBinding: array expected");o.updateBinding=[];for(var i=0;i<t.updateBinding.length;++i){if(typeof t.updateBinding[i]!="object")throw TypeError(".onnx.TrainingInfoProto.updateBinding: object expected");o.updateBinding[i]=A.onnx.StringStringEntryProto.fromObject(t.updateBinding[i])}}return o},e.toObject=function(t,o){o||(o={});var i={};if((o.arrays||o.defaults)&&(i.initializationBinding=[],i.updateBinding=[]),o.defaults&&(i.initialization=null,i.algorithm=null),t.initialization!=null&&t.hasOwnProperty("initialization")&&(i.initialization=A.onnx.GraphProto.toObject(t.initialization,o)),t.algorithm!=null&&t.hasOwnProperty("algorithm")&&(i.algorithm=A.onnx.GraphProto.toObject(t.algorithm,o)),t.initializationBinding&&t.initializationBinding.length){i.initializationBinding=[];for(var a=0;a<t.initializationBinding.length;++a)i.initializationBinding[a]=A.onnx.StringStringEntryProto.toObject(t.initializationBinding[a],o)}if(t.updateBinding&&t.updateBinding.length){i.updateBinding=[];for(var a=0;a<t.updateBinding.length;++a)i.updateBinding[a]=A.onnx.StringStringEntryProto.toObject(t.updateBinding[a],o)}return i},e.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},e.getTypeUrl=function(t){return t===void 0&&(t="type.googleapis.com"),t+"/onnx.TrainingInfoProto"},e})(),r.ModelProto=(function(){function e(n){if(this.opsetImport=[],this.metadataProps=[],this.trainingInfo=[],this.functions=[],n)for(var t=Object.keys(n),o=0;o<t.length;++o)n[t[o]]!=null&&(this[t[o]]=n[t[o]])}return e.prototype.irVersion=C.Long?C.Long.fromBits(0,0,!1):0,e.prototype.opsetImport=C.emptyArray,e.prototype.producerName="",e.prototype.producerVersion="",e.prototype.domain="",e.prototype.modelVersion=C.Long?C.Long.fromBits(0,0,!1):0,e.prototype.docString="",e.prototype.graph=null,e.prototype.metadataProps=C.emptyArray,e.prototype.trainingInfo=C.emptyArray,e.prototype.functions=C.emptyArray,e.create=function(t){return new e(t)},e.encode=function(t,o){if(o||(o=rt.create()),t.irVersion!=null&&Object.hasOwnProperty.call(t,"irVersion")&&o.uint32(8).int64(t.irVersion),t.producerName!=null&&Object.hasOwnProperty.call(t,"producerName")&&o.uint32(18).string(t.producerName),t.producerVersion!=null&&Object.hasOwnProperty.call(t,"producerVersion")&&o.uint32(26).string(t.producerVersion),t.domain!=null&&Object.hasOwnProperty.call(t,"domain")&&o.uint32(34).string(t.domain),t.modelVersion!=null&&Object.hasOwnProperty.call(t,"modelVersion")&&o.uint32(40).int64(t.modelVersion),t.docString!=null&&Object.hasOwnProperty.call(t,"docString")&&o.uint32(50).string(t.docString),t.graph!=null&&Object.hasOwnProperty.call(t,"graph")&&A.onnx.GraphProto.encode(t.graph,o.uint32(58).fork()).ldelim(),t.opsetImport!=null&&t.opsetImport.length)for(var i=0;i<t.opsetImport.length;++i)A.onnx.OperatorSetIdProto.encode(t.opsetImport[i],o.uint32(66).fork()).ldelim();if(t.metadataProps!=null&&t.metadataProps.length)for(var i=0;i<t.metadataProps.length;++i)A.onnx.StringStringEntryProto.encode(t.metadataProps[i],o.uint32(114).fork()).ldelim();if(t.trainingInfo!=null&&t.trainingInfo.length)for(var i=0;i<t.trainingInfo.length;++i)A.onnx.TrainingInfoProto.encode(t.trainingInfo[i],o.uint32(162).fork()).ldelim();if(t.functions!=null&&t.functions.length)for(var i=0;i<t.functions.length;++i)A.onnx.FunctionProto.encode(t.functions[i],o.uint32(202).fork()).ldelim();return o},e.encodeDelimited=function(t,o){return this.encode(t,o).ldelim()},e.decode=function(t,o){t instanceof Q||(t=Q.create(t));for(var i=o===void 0?t.len:t.pos+o,a=new A.onnx.ModelProto;t.pos<i;){var s=t.uint32();switch(s>>>3){case 1:{a.irVersion=t.int64();break}case 8:{a.opsetImport&&a.opsetImport.length||(a.opsetImport=[]),a.opsetImport.push(A.onnx.OperatorSetIdProto.decode(t,t.uint32()));break}case 2:{a.producerName=t.string();break}case 3:{a.producerVersion=t.string();break}case 4:{a.domain=t.string();break}case 5:{a.modelVersion=t.int64();break}case 6:{a.docString=t.string();break}case 7:{a.graph=A.onnx.GraphProto.decode(t,t.uint32());break}case 14:{a.metadataProps&&a.metadataProps.length||(a.metadataProps=[]),a.metadataProps.push(A.onnx.StringStringEntryProto.decode(t,t.uint32()));break}case 20:{a.trainingInfo&&a.trainingInfo.length||(a.trainingInfo=[]),a.trainingInfo.push(A.onnx.TrainingInfoProto.decode(t,t.uint32()));break}case 25:{a.functions&&a.functions.length||(a.functions=[]),a.functions.push(A.onnx.FunctionProto.decode(t,t.uint32()));break}default:t.skipType(s&7);break}}return a},e.decodeDelimited=function(t){return t instanceof Q||(t=new Q(t)),this.decode(t,t.uint32())},e.verify=function(t){if(typeof t!="object"||t===null)return"object expected";if(t.irVersion!=null&&t.hasOwnProperty("irVersion")&&!C.isInteger(t.irVersion)&&!(t.irVersion&&C.isInteger(t.irVersion.low)&&C.isInteger(t.irVersion.high)))return"irVersion: integer|Long expected";if(t.opsetImport!=null&&t.hasOwnProperty("opsetImport")){if(!Array.isArray(t.opsetImport))return"opsetImport: array expected";for(var o=0;o<t.opsetImport.length;++o){var i=A.onnx.OperatorSetIdProto.verify(t.opsetImport[o]);if(i)return"opsetImport."+i}}if(t.producerName!=null&&t.hasOwnProperty("producerName")&&!C.isString(t.producerName))return"producerName: string expected";if(t.producerVersion!=null&&t.hasOwnProperty("producerVersion")&&!C.isString(t.producerVersion))return"producerVersion: string expected";if(t.domain!=null&&t.hasOwnProperty("domain")&&!C.isString(t.domain))return"domain: string expected";if(t.modelVersion!=null&&t.hasOwnProperty("modelVersion")&&!C.isInteger(t.modelVersion)&&!(t.modelVersion&&C.isInteger(t.modelVersion.low)&&C.isInteger(t.modelVersion.high)))return"modelVersion: integer|Long expected";if(t.docString!=null&&t.hasOwnProperty("docString")&&!C.isString(t.docString))return"docString: string expected";if(t.graph!=null&&t.hasOwnProperty("graph")){var i=A.onnx.GraphProto.verify(t.graph);if(i)return"graph."+i}if(t.metadataProps!=null&&t.hasOwnProperty("metadataProps")){if(!Array.isArray(t.metadataProps))return"metadataProps: array expected";for(var o=0;o<t.metadataProps.length;++o){var i=A.onnx.StringStringEntryProto.verify(t.metadataProps[o]);if(i)return"metadataProps."+i}}if(t.trainingInfo!=null&&t.hasOwnProperty("trainingInfo")){if(!Array.isArray(t.trainingInfo))return"trainingInfo: array expected";for(var o=0;o<t.trainingInfo.length;++o){var i=A.onnx.TrainingInfoProto.verify(t.trainingInfo[o]);if(i)return"trainingInfo."+i}}if(t.functions!=null&&t.hasOwnProperty("functions")){if(!Array.isArray(t.functions))return"functions: array expected";for(var o=0;o<t.functions.length;++o){var i=A.onnx.FunctionProto.verify(t.functions[o]);if(i)return"functions."+i}}return null},e.fromObject=function(t){if(t instanceof A.onnx.ModelProto)return t;var o=new A.onnx.ModelProto;if(t.irVersion!=null&&(C.Long?(o.irVersion=C.Long.fromValue(t.irVersion)).unsigned=!1:typeof t.irVersion=="string"?o.irVersion=parseInt(t.irVersion,10):typeof t.irVersion=="number"?o.irVersion=t.irVersion:typeof t.irVersion=="object"&&(o.irVersion=new C.LongBits(t.irVersion.low>>>0,t.irVersion.high>>>0).toNumber())),t.opsetImport){if(!Array.isArray(t.opsetImport))throw TypeError(".onnx.ModelProto.opsetImport: array expected");o.opsetImport=[];for(var i=0;i<t.opsetImport.length;++i){if(typeof t.opsetImport[i]!="object")throw TypeError(".onnx.ModelProto.opsetImport: object expected");o.opsetImport[i]=A.onnx.OperatorSetIdProto.fromObject(t.opsetImport[i])}}if(t.producerName!=null&&(o.producerName=String(t.producerName)),t.producerVersion!=null&&(o.producerVersion=String(t.producerVersion)),t.domain!=null&&(o.domain=String(t.domain)),t.modelVersion!=null&&(C.Long?(o.modelVersion=C.Long.fromValue(t.modelVersion)).unsigned=!1:typeof t.modelVersion=="string"?o.modelVersion=parseInt(t.modelVersion,10):typeof t.modelVersion=="number"?o.modelVersion=t.modelVersion:typeof t.modelVersion=="object"&&(o.modelVersion=new C.LongBits(t.modelVersion.low>>>0,t.modelVersion.high>>>0).toNumber())),t.docString!=null&&(o.docString=String(t.docString)),t.graph!=null){if(typeof t.graph!="object")throw TypeError(".onnx.ModelProto.graph: object expected");o.graph=A.onnx.GraphProto.fromObject(t.graph)}if(t.metadataProps){if(!Array.isArray(t.metadataProps))throw TypeError(".onnx.ModelProto.metadataProps: array expected");o.metadataProps=[];for(var i=0;i<t.metadataProps.length;++i){if(typeof t.metadataProps[i]!="object")throw TypeError(".onnx.ModelProto.metadataProps: object expected");o.metadataProps[i]=A.onnx.StringStringEntryProto.fromObject(t.metadataProps[i])}}if(t.trainingInfo){if(!Array.isArray(t.trainingInfo))throw TypeError(".onnx.ModelProto.trainingInfo: array expected");o.trainingInfo=[];for(var i=0;i<t.trainingInfo.length;++i){if(typeof t.trainingInfo[i]!="object")throw TypeError(".onnx.ModelProto.trainingInfo: object expected");o.trainingInfo[i]=A.onnx.TrainingInfoProto.fromObject(t.trainingInfo[i])}}if(t.functions){if(!Array.isArray(t.functions))throw TypeError(".onnx.ModelProto.functions: array expected");o.functions=[];for(var i=0;i<t.functions.length;++i){if(typeof t.functions[i]!="object")throw TypeError(".onnx.ModelProto.functions: object expected");o.functions[i]=A.onnx.FunctionProto.fromObject(t.functions[i])}}return o},e.toObject=function(t,o){o||(o={});var i={};if((o.arrays||o.defaults)&&(i.opsetImport=[],i.metadataProps=[],i.trainingInfo=[],i.functions=[]),o.defaults){if(C.Long){var a=new C.Long(0,0,!1);i.irVersion=o.longs===String?a.toString():o.longs===Number?a.toNumber():a}else i.irVersion=o.longs===String?"0":0;if(i.producerName="",i.producerVersion="",i.domain="",C.Long){var a=new C.Long(0,0,!1);i.modelVersion=o.longs===String?a.toString():o.longs===Number?a.toNumber():a}else i.modelVersion=o.longs===String?"0":0;i.docString="",i.graph=null}if(t.irVersion!=null&&t.hasOwnProperty("irVersion")&&(typeof t.irVersion=="number"?i.irVersion=o.longs===String?String(t.irVersion):t.irVersion:i.irVersion=o.longs===String?C.Long.prototype.toString.call(t.irVersion):o.longs===Number?new C.LongBits(t.irVersion.low>>>0,t.irVersion.high>>>0).toNumber():t.irVersion),t.producerName!=null&&t.hasOwnProperty("producerName")&&(i.producerName=t.producerName),t.producerVersion!=null&&t.hasOwnProperty("producerVersion")&&(i.producerVersion=t.producerVersion),t.domain!=null&&t.hasOwnProperty("domain")&&(i.domain=t.domain),t.modelVersion!=null&&t.hasOwnProperty("modelVersion")&&(typeof t.modelVersion=="number"?i.modelVersion=o.longs===String?String(t.modelVersion):t.modelVersion:i.modelVersion=o.longs===String?C.Long.prototype.toString.call(t.modelVersion):o.longs===Number?new C.LongBits(t.modelVersion.low>>>0,t.modelVersion.high>>>0).toNumber():t.modelVersion),t.docString!=null&&t.hasOwnProperty("docString")&&(i.docString=t.docString),t.graph!=null&&t.hasOwnProperty("graph")&&(i.graph=A.onnx.GraphProto.toObject(t.graph,o)),t.opsetImport&&t.opsetImport.length){i.opsetImport=[];for(var s=0;s<t.opsetImport.length;++s)i.opsetImport[s]=A.onnx.OperatorSetIdProto.toObject(t.opsetImport[s],o)}if(t.metadataProps&&t.metadataProps.length){i.metadataProps=[];for(var s=0;s<t.metadataProps.length;++s)i.metadataProps[s]=A.onnx.StringStringEntryProto.toObject(t.metadataProps[s],o)}if(t.trainingInfo&&t.trainingInfo.length){i.trainingInfo=[];for(var s=0;s<t.trainingInfo.length;++s)i.trainingInfo[s]=A.onnx.TrainingInfoProto.toObject(t.trainingInfo[s],o)}if(t.functions&&t.functions.length){i.functions=[];for(var s=0;s<t.functions.length;++s)i.functions[s]=A.onnx.FunctionProto.toObject(t.functions[s],o)}return i},e.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},e.getTypeUrl=function(t){return t===void 0&&(t="type.googleapis.com"),t+"/onnx.ModelProto"},e})(),r.StringStringEntryProto=(function(){function e(n){if(n)for(var t=Object.keys(n),o=0;o<t.length;++o)n[t[o]]!=null&&(this[t[o]]=n[t[o]])}return e.prototype.key="",e.prototype.value="",e.create=function(t){return new e(t)},e.encode=function(t,o){return o||(o=rt.create()),t.key!=null&&Object.hasOwnProperty.call(t,"key")&&o.uint32(10).string(t.key),t.value!=null&&Object.hasOwnProperty.call(t,"value")&&o.uint32(18).string(t.value),o},e.encodeDelimited=function(t,o){return this.encode(t,o).ldelim()},e.decode=function(t,o){t instanceof Q||(t=Q.create(t));for(var i=o===void 0?t.len:t.pos+o,a=new A.onnx.StringStringEntryProto;t.pos<i;){var s=t.uint32();switch(s>>>3){case 1:{a.key=t.string();break}case 2:{a.value=t.string();break}default:t.skipType(s&7);break}}return a},e.decodeDelimited=function(t){return t instanceof Q||(t=new Q(t)),this.decode(t,t.uint32())},e.verify=function(t){return typeof t!="object"||t===null?"object expected":t.key!=null&&t.hasOwnProperty("key")&&!C.isString(t.key)?"key: string expected":t.value!=null&&t.hasOwnProperty("value")&&!C.isString(t.value)?"value: string expected":null},e.fromObject=function(t){if(t instanceof A.onnx.StringStringEntryProto)return t;var o=new A.onnx.StringStringEntryProto;return t.key!=null&&(o.key=String(t.key)),t.value!=null&&(o.value=String(t.value)),o},e.toObject=function(t,o){o||(o={});var i={};return o.defaults&&(i.key="",i.value=""),t.key!=null&&t.hasOwnProperty("key")&&(i.key=t.key),t.value!=null&&t.hasOwnProperty("value")&&(i.value=t.value),i},e.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},e.getTypeUrl=function(t){return t===void 0&&(t="type.googleapis.com"),t+"/onnx.StringStringEntryProto"},e})(),r.TensorAnnotation=(function(){function e(n){if(this.quantParameterTensorNames=[],n)for(var t=Object.keys(n),o=0;o<t.length;++o)n[t[o]]!=null&&(this[t[o]]=n[t[o]])}return e.prototype.tensorName="",e.prototype.quantParameterTensorNames=C.emptyArray,e.create=function(t){return new e(t)},e.encode=function(t,o){if(o||(o=rt.create()),t.tensorName!=null&&Object.hasOwnProperty.call(t,"tensorName")&&o.uint32(10).string(t.tensorName),t.quantParameterTensorNames!=null&&t.quantParameterTensorNames.length)for(var i=0;i<t.quantParameterTensorNames.length;++i)A.onnx.StringStringEntryProto.encode(t.quantParameterTensorNames[i],o.uint32(18).fork()).ldelim();return o},e.encodeDelimited=function(t,o){return this.encode(t,o).ldelim()},e.decode=function(t,o){t instanceof Q||(t=Q.create(t));for(var i=o===void 0?t.len:t.pos+o,a=new A.onnx.TensorAnnotation;t.pos<i;){var s=t.uint32();switch(s>>>3){case 1:{a.tensorName=t.string();break}case 2:{a.quantParameterTensorNames&&a.quantParameterTensorNames.length||(a.quantParameterTensorNames=[]),a.quantParameterTensorNames.push(A.onnx.StringStringEntryProto.decode(t,t.uint32()));break}default:t.skipType(s&7);break}}return a},e.decodeDelimited=function(t){return t instanceof Q||(t=new Q(t)),this.decode(t,t.uint32())},e.verify=function(t){if(typeof t!="object"||t===null)return"object expected";if(t.tensorName!=null&&t.hasOwnProperty("tensorName")&&!C.isString(t.tensorName))return"tensorName: string expected";if(t.quantParameterTensorNames!=null&&t.hasOwnProperty("quantParameterTensorNames")){if(!Array.isArray(t.quantParameterTensorNames))return"quantParameterTensorNames: array expected";for(var o=0;o<t.quantParameterTensorNames.length;++o){var i=A.onnx.StringStringEntryProto.verify(t.quantParameterTensorNames[o]);if(i)return"quantParameterTensorNames."+i}}return null},e.fromObject=function(t){if(t instanceof A.onnx.TensorAnnotation)return t;var o=new A.onnx.TensorAnnotation;if(t.tensorName!=null&&(o.tensorName=String(t.tensorName)),t.quantParameterTensorNames){if(!Array.isArray(t.quantParameterTensorNames))throw TypeError(".onnx.TensorAnnotation.quantParameterTensorNames: array expected");o.quantParameterTensorNames=[];for(var i=0;i<t.quantParameterTensorNames.length;++i){if(typeof t.quantParameterTensorNames[i]!="object")throw TypeError(".onnx.TensorAnnotation.quantParameterTensorNames: object expected");o.quantParameterTensorNames[i]=A.onnx.StringStringEntryProto.fromObject(t.quantParameterTensorNames[i])}}return o},e.toObject=function(t,o){o||(o={});var i={};if((o.arrays||o.defaults)&&(i.quantParameterTensorNames=[]),o.defaults&&(i.tensorName=""),t.tensorName!=null&&t.hasOwnProperty("tensorName")&&(i.tensorName=t.tensorName),t.quantParameterTensorNames&&t.quantParameterTensorNames.length){i.quantParameterTensorNames=[];for(var a=0;a<t.quantParameterTensorNames.length;++a)i.quantParameterTensorNames[a]=A.onnx.StringStringEntryProto.toObject(t.quantParameterTensorNames[a],o)}return i},e.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},e.getTypeUrl=function(t){return t===void 0&&(t="type.googleapis.com"),t+"/onnx.TensorAnnotation"},e})(),r.GraphProto=(function(){function e(n){if(this.node=[],this.initializer=[],this.sparseInitializer=[],this.input=[],this.output=[],this.valueInfo=[],this.quantizationAnnotation=[],n)for(var t=Object.keys(n),o=0;o<t.length;++o)n[t[o]]!=null&&(this[t[o]]=n[t[o]])}return e.prototype.node=C.emptyArray,e.prototype.name="",e.prototype.initializer=C.emptyArray,e.prototype.sparseInitializer=C.emptyArray,e.prototype.docString="",e.prototype.input=C.emptyArray,e.prototype.output=C.emptyArray,e.prototype.valueInfo=C.emptyArray,e.prototype.quantizationAnnotation=C.emptyArray,e.create=function(t){return new e(t)},e.encode=function(t,o){if(o||(o=rt.create()),t.node!=null&&t.node.length)for(var i=0;i<t.node.length;++i)A.onnx.NodeProto.encode(t.node[i],o.uint32(10).fork()).ldelim();if(t.name!=null&&Object.hasOwnProperty.call(t,"name")&&o.uint32(18).string(t.name),t.initializer!=null&&t.initializer.length)for(var i=0;i<t.initializer.length;++i)A.onnx.TensorProto.encode(t.initializer[i],o.uint32(42).fork()).ldelim();if(t.docString!=null&&Object.hasOwnProperty.call(t,"docString")&&o.uint32(82).string(t.docString),t.input!=null&&t.input.length)for(var i=0;i<t.input.length;++i)A.onnx.ValueInfoProto.encode(t.input[i],o.uint32(90).fork()).ldelim();if(t.output!=null&&t.output.length)for(var i=0;i<t.output.length;++i)A.onnx.ValueInfoProto.encode(t.output[i],o.uint32(98).fork()).ldelim();if(t.valueInfo!=null&&t.valueInfo.length)for(var i=0;i<t.valueInfo.length;++i)A.onnx.ValueInfoProto.encode(t.valueInfo[i],o.uint32(106).fork()).ldelim();if(t.quantizationAnnotation!=null&&t.quantizationAnnotation.length)for(var i=0;i<t.quantizationAnnotation.length;++i)A.onnx.TensorAnnotation.encode(t.quantizationAnnotation[i],o.uint32(114).fork()).ldelim();if(t.sparseInitializer!=null&&t.sparseInitializer.length)for(var i=0;i<t.sparseInitializer.length;++i)A.onnx.SparseTensorProto.encode(t.sparseInitializer[i],o.uint32(122).fork()).ldelim();return o},e.encodeDelimited=function(t,o){return this.encode(t,o).ldelim()},e.decode=function(t,o){t instanceof Q||(t=Q.create(t));for(var i=o===void 0?t.len:t.pos+o,a=new A.onnx.GraphProto;t.pos<i;){var s=t.uint32();switch(s>>>3){case 1:{a.node&&a.node.length||(a.node=[]),a.node.push(A.onnx.NodeProto.decode(t,t.uint32()));break}case 2:{a.name=t.string();break}case 5:{a.initializer&&a.initializer.length||(a.initializer=[]),a.initializer.push(A.onnx.TensorProto.decode(t,t.uint32()));break}case 15:{a.sparseInitializer&&a.sparseInitializer.length||(a.sparseInitializer=[]),a.sparseInitializer.push(A.onnx.SparseTensorProto.decode(t,t.uint32()));break}case 10:{a.docString=t.string();break}case 11:{a.input&&a.input.length||(a.input=[]),a.input.push(A.onnx.ValueInfoProto.decode(t,t.uint32()));break}case 12:{a.output&&a.output.length||(a.output=[]),a.output.push(A.onnx.ValueInfoProto.decode(t,t.uint32()));break}case 13:{a.valueInfo&&a.valueInfo.length||(a.valueInfo=[]),a.valueInfo.push(A.onnx.ValueInfoProto.decode(t,t.uint32()));break}case 14:{a.quantizationAnnotation&&a.quantizationAnnotation.length||(a.quantizationAnnotation=[]),a.quantizationAnnotation.push(A.onnx.TensorAnnotation.decode(t,t.uint32()));break}default:t.skipType(s&7);break}}return a},e.decodeDelimited=function(t){return t instanceof Q||(t=new Q(t)),this.decode(t,t.uint32())},e.verify=function(t){if(typeof t!="object"||t===null)return"object expected";if(t.node!=null&&t.hasOwnProperty("node")){if(!Array.isArray(t.node))return"node: array expected";for(var o=0;o<t.node.length;++o){var i=A.onnx.NodeProto.verify(t.node[o]);if(i)return"node."+i}}if(t.name!=null&&t.hasOwnProperty("name")&&!C.isString(t.name))return"name: string expected";if(t.initializer!=null&&t.hasOwnProperty("initializer")){if(!Array.isArray(t.initializer))return"initializer: array expected";for(var o=0;o<t.initializer.length;++o){var i=A.onnx.TensorProto.verify(t.initializer[o]);if(i)return"initializer."+i}}if(t.sparseInitializer!=null&&t.hasOwnProperty("sparseInitializer")){if(!Array.isArray(t.sparseInitializer))return"sparseInitializer: array expected";for(var o=0;o<t.sparseInitializer.length;++o){var i=A.onnx.SparseTensorProto.verify(t.sparseInitializer[o]);if(i)return"sparseInitializer."+i}}if(t.docString!=null&&t.hasOwnProperty("docString")&&!C.isString(t.docString))return"docString: string expected";if(t.input!=null&&t.hasOwnProperty("input")){if(!Array.isArray(t.input))return"input: array expected";for(var o=0;o<t.input.length;++o){var i=A.onnx.ValueInfoProto.verify(t.input[o]);if(i)return"input."+i}}if(t.output!=null&&t.hasOwnProperty("output")){if(!Array.isArray(t.output))return"output: array expected";for(var o=0;o<t.output.length;++o){var i=A.onnx.ValueInfoProto.verify(t.output[o]);if(i)return"output."+i}}if(t.valueInfo!=null&&t.hasOwnProperty("valueInfo")){if(!Array.isArray(t.valueInfo))return"valueInfo: array expected";for(var o=0;o<t.valueInfo.length;++o){var i=A.onnx.ValueInfoProto.verify(t.valueInfo[o]);if(i)return"valueInfo."+i}}if(t.quantizationAnnotation!=null&&t.hasOwnProperty("quantizationAnnotation")){if(!Array.isArray(t.quantizationAnnotation))return"quantizationAnnotation: array expected";for(var o=0;o<t.quantizationAnnotation.length;++o){var i=A.onnx.TensorAnnotation.verify(t.quantizationAnnotation[o]);if(i)return"quantizationAnnotation."+i}}return null},e.fromObject=function(t){if(t instanceof A.onnx.GraphProto)return t;var o=new A.onnx.GraphProto;if(t.node){if(!Array.isArray(t.node))throw TypeError(".onnx.GraphProto.node: array expected");o.node=[];for(var i=0;i<t.node.length;++i){if(typeof t.node[i]!="object")throw TypeError(".onnx.GraphProto.node: object expected");o.node[i]=A.onnx.NodeProto.fromObject(t.node[i])}}if(t.name!=null&&(o.name=String(t.name)),t.initializer){if(!Array.isArray(t.initializer))throw TypeError(".onnx.GraphProto.initializer: array expected");o.initializer=[];for(var i=0;i<t.initializer.length;++i){if(typeof t.initializer[i]!="object")throw TypeError(".onnx.GraphProto.initializer: object expected");o.initializer[i]=A.onnx.TensorProto.fromObject(t.initializer[i])}}if(t.sparseInitializer){if(!Array.isArray(t.sparseInitializer))throw TypeError(".onnx.GraphProto.sparseInitializer: array expected");o.sparseInitializer=[];for(var i=0;i<t.sparseInitializer.length;++i){if(typeof t.sparseInitializer[i]!="object")throw TypeError(".onnx.GraphProto.sparseInitializer: object expected");o.sparseInitializer[i]=A.onnx.SparseTensorProto.fromObject(t.sparseInitializer[i])}}if(t.docString!=null&&(o.docString=String(t.docString)),t.input){if(!Array.isArray(t.input))throw TypeError(".onnx.GraphProto.input: array expected");o.input=[];for(var i=0;i<t.input.length;++i){if(typeof t.input[i]!="object")throw TypeError(".onnx.GraphProto.input: object expected");o.input[i]=A.onnx.ValueInfoProto.fromObject(t.input[i])}}if(t.output){if(!Array.isArray(t.output))throw TypeError(".onnx.GraphProto.output: array expected");o.output=[];for(var i=0;i<t.output.length;++i){if(typeof t.output[i]!="object")throw TypeError(".onnx.GraphProto.output: object expected");o.output[i]=A.onnx.ValueInfoProto.fromObject(t.output[i])}}if(t.valueInfo){if(!Array.isArray(t.valueInfo))throw TypeError(".onnx.GraphProto.valueInfo: array expected");o.valueInfo=[];for(var i=0;i<t.valueInfo.length;++i){if(typeof t.valueInfo[i]!="object")throw TypeError(".onnx.GraphProto.valueInfo: object expected");o.valueInfo[i]=A.onnx.ValueInfoProto.fromObject(t.valueInfo[i])}}if(t.quantizationAnnotation){if(!Array.isArray(t.quantizationAnnotation))throw TypeError(".onnx.GraphProto.quantizationAnnotation: array expected");o.quantizationAnnotation=[];for(var i=0;i<t.quantizationAnnotation.length;++i){if(typeof t.quantizationAnnotation[i]!="object")throw TypeError(".onnx.GraphProto.quantizationAnnotation: object expected");o.quantizationAnnotation[i]=A.onnx.TensorAnnotation.fromObject(t.quantizationAnnotation[i])}}return o},e.toObject=function(t,o){o||(o={});var i={};if((o.arrays||o.defaults)&&(i.node=[],i.initializer=[],i.input=[],i.output=[],i.valueInfo=[],i.quantizationAnnotation=[],i.sparseInitializer=[]),o.defaults&&(i.name="",i.docString=""),t.node&&t.node.length){i.node=[];for(var a=0;a<t.node.length;++a)i.node[a]=A.onnx.NodeProto.toObject(t.node[a],o)}if(t.name!=null&&t.hasOwnProperty("name")&&(i.name=t.name),t.initializer&&t.initializer.length){i.initializer=[];for(var a=0;a<t.initializer.length;++a)i.initializer[a]=A.onnx.TensorProto.toObject(t.initializer[a],o)}if(t.docString!=null&&t.hasOwnProperty("docString")&&(i.docString=t.docString),t.input&&t.input.length){i.input=[];for(var a=0;a<t.input.length;++a)i.input[a]=A.onnx.ValueInfoProto.toObject(t.input[a],o)}if(t.output&&t.output.length){i.output=[];for(var a=0;a<t.output.length;++a)i.output[a]=A.onnx.ValueInfoProto.toObject(t.output[a],o)}if(t.valueInfo&&t.valueInfo.length){i.valueInfo=[];for(var a=0;a<t.valueInfo.length;++a)i.valueInfo[a]=A.onnx.ValueInfoProto.toObject(t.valueInfo[a],o)}if(t.quantizationAnnotation&&t.quantizationAnnotation.length){i.quantizationAnnotation=[];for(var a=0;a<t.quantizationAnnotation.length;++a)i.quantizationAnnotation[a]=A.onnx.TensorAnnotation.toObject(t.quantizationAnnotation[a],o)}if(t.sparseInitializer&&t.sparseInitializer.length){i.sparseInitializer=[];for(var a=0;a<t.sparseInitializer.length;++a)i.sparseInitializer[a]=A.onnx.SparseTensorProto.toObject(t.sparseInitializer[a],o)}return i},e.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},e.getTypeUrl=function(t){return t===void 0&&(t="type.googleapis.com"),t+"/onnx.GraphProto"},e})(),r.TensorProto=(function(){function e(n){if(this.dims=[],this.floatData=[],this.int32Data=[],this.stringData=[],this.int64Data=[],this.externalData=[],this.doubleData=[],this.uint64Data=[],n)for(var t=Object.keys(n),o=0;o<t.length;++o)n[t[o]]!=null&&(this[t[o]]=n[t[o]])}return e.prototype.dims=C.emptyArray,e.prototype.dataType=0,e.prototype.segment=null,e.prototype.floatData=C.emptyArray,e.prototype.int32Data=C.emptyArray,e.prototype.stringData=C.emptyArray,e.prototype.int64Data=C.emptyArray,e.prototype.name="",e.prototype.docString="",e.prototype.rawData=C.newBuffer([]),e.prototype.externalData=C.emptyArray,e.prototype.dataLocation=0,e.prototype.doubleData=C.emptyArray,e.prototype.uint64Data=C.emptyArray,e.create=function(t){return new e(t)},e.encode=function(t,o){if(o||(o=rt.create()),t.dims!=null&&t.dims.length){o.uint32(10).fork();for(var i=0;i<t.dims.length;++i)o.int64(t.dims[i]);o.ldelim()}if(t.dataType!=null&&Object.hasOwnProperty.call(t,"dataType")&&o.uint32(16).int32(t.dataType),t.segment!=null&&Object.hasOwnProperty.call(t,"segment")&&A.onnx.TensorProto.Segment.encode(t.segment,o.uint32(26).fork()).ldelim(),t.floatData!=null&&t.floatData.length){o.uint32(34).fork();for(var i=0;i<t.floatData.length;++i)o.float(t.floatData[i]);o.ldelim()}if(t.int32Data!=null&&t.int32Data.length){o.uint32(42).fork();for(var i=0;i<t.int32Data.length;++i)o.int32(t.int32Data[i]);o.ldelim()}if(t.stringData!=null&&t.stringData.length)for(var i=0;i<t.stringData.length;++i)o.uint32(50).bytes(t.stringData[i]);if(t.int64Data!=null&&t.int64Data.length){o.uint32(58).fork();for(var i=0;i<t.int64Data.length;++i)o.int64(t.int64Data[i]);o.ldelim()}if(t.name!=null&&Object.hasOwnProperty.call(t,"name")&&o.uint32(66).string(t.name),t.rawData!=null&&Object.hasOwnProperty.call(t,"rawData")&&o.uint32(74).bytes(t.rawData),t.doubleData!=null&&t.doubleData.length){o.uint32(82).fork();for(var i=0;i<t.doubleData.length;++i)o.double(t.doubleData[i]);o.ldelim()}if(t.uint64Data!=null&&t.uint64Data.length){o.uint32(90).fork();for(var i=0;i<t.uint64Data.length;++i)o.uint64(t.uint64Data[i]);o.ldelim()}if(t.docString!=null&&Object.hasOwnProperty.call(t,"docString")&&o.uint32(98).string(t.docString),t.externalData!=null&&t.externalData.length)for(var i=0;i<t.externalData.length;++i)A.onnx.StringStringEntryProto.encode(t.externalData[i],o.uint32(106).fork()).ldelim();return t.dataLocation!=null&&Object.hasOwnProperty.call(t,"dataLocation")&&o.uint32(112).int32(t.dataLocation),o},e.encodeDelimited=function(t,o){return this.encode(t,o).ldelim()},e.decode=function(t,o){t instanceof Q||(t=Q.create(t));for(var i=o===void 0?t.len:t.pos+o,a=new A.onnx.TensorProto;t.pos<i;){var s=t.uint32();switch(s>>>3){case 1:{if(a.dims&&a.dims.length||(a.dims=[]),(s&7)===2)for(var u=t.uint32()+t.pos;t.pos<u;)a.dims.push(t.int64());else a.dims.push(t.int64());break}case 2:{a.dataType=t.int32();break}case 3:{a.segment=A.onnx.TensorProto.Segment.decode(t,t.uint32());break}case 4:{if(a.floatData&&a.floatData.length||(a.floatData=[]),(s&7)===2)for(var u=t.uint32()+t.pos;t.pos<u;)a.floatData.push(t.float());else a.floatData.push(t.float());break}case 5:{if(a.int32Data&&a.int32Data.length||(a.int32Data=[]),(s&7)===2)for(var u=t.uint32()+t.pos;t.pos<u;)a.int32Data.push(t.int32());else a.int32Data.push(t.int32());break}case 6:{a.stringData&&a.stringData.length||(a.stringData=[]),a.stringData.push(t.bytes());break}case 7:{if(a.int64Data&&a.int64Data.length||(a.int64Data=[]),(s&7)===2)for(var u=t.uint32()+t.pos;t.pos<u;)a.int64Data.push(t.int64());else a.int64Data.push(t.int64());break}case 8:{a.name=t.string();break}case 12:{a.docString=t.string();break}case 9:{a.rawData=t.bytes();break}case 13:{a.externalData&&a.externalData.length||(a.externalData=[]),a.externalData.push(A.onnx.StringStringEntryProto.decode(t,t.uint32()));break}case 14:{a.dataLocation=t.int32();break}case 10:{if(a.doubleData&&a.doubleData.length||(a.doubleData=[]),(s&7)===2)for(var u=t.uint32()+t.pos;t.pos<u;)a.doubleData.push(t.double());else a.doubleData.push(t.double());break}case 11:{if(a.uint64Data&&a.uint64Data.length||(a.uint64Data=[]),(s&7)===2)for(var u=t.uint32()+t.pos;t.pos<u;)a.uint64Data.push(t.uint64());else a.uint64Data.push(t.uint64());break}default:t.skipType(s&7);break}}return a},e.decodeDelimited=function(t){return t instanceof Q||(t=new Q(t)),this.decode(t,t.uint32())},e.verify=function(t){if(typeof t!="object"||t===null)return"object expected";if(t.dims!=null&&t.hasOwnProperty("dims")){if(!Array.isArray(t.dims))return"dims: array expected";for(var o=0;o<t.dims.length;++o)if(!C.isInteger(t.dims[o])&&!(t.dims[o]&&C.isInteger(t.dims[o].low)&&C.isInteger(t.dims[o].high)))return"dims: integer|Long[] expected"}if(t.dataType!=null&&t.hasOwnProperty("dataType")&&!C.isInteger(t.dataType))return"dataType: integer expected";if(t.segment!=null&&t.hasOwnProperty("segment")){var i=A.onnx.TensorProto.Segment.verify(t.segment);if(i)return"segment."+i}if(t.floatData!=null&&t.hasOwnProperty("floatData")){if(!Array.isArray(t.floatData))return"floatData: array expected";for(var o=0;o<t.floatData.length;++o)if(typeof t.floatData[o]!="number")return"floatData: number[] expected"}if(t.int32Data!=null&&t.hasOwnProperty("int32Data")){if(!Array.isArray(t.int32Data))return"int32Data: array expected";for(var o=0;o<t.int32Data.length;++o)if(!C.isInteger(t.int32Data[o]))return"int32Data: integer[] expected"}if(t.stringData!=null&&t.hasOwnProperty("stringData")){if(!Array.isArray(t.stringData))return"stringData: array expected";for(var o=0;o<t.stringData.length;++o)if(!(t.stringData[o]&&typeof t.stringData[o].length=="number"||C.isString(t.stringData[o])))return"stringData: buffer[] expected"}if(t.int64Data!=null&&t.hasOwnProperty("int64Data")){if(!Array.isArray(t.int64Data))return"int64Data: array expected";for(var o=0;o<t.int64Data.length;++o)if(!C.isInteger(t.int64Data[o])&&!(t.int64Data[o]&&C.isInteger(t.int64Data[o].low)&&C.isInteger(t.int64Data[o].high)))return"int64Data: integer|Long[] expected"}if(t.name!=null&&t.hasOwnProperty("name")&&!C.isString(t.name))return"name: string expected";if(t.docString!=null&&t.hasOwnProperty("docString")&&!C.isString(t.docString))return"docString: string expected";if(t.rawData!=null&&t.hasOwnProperty("rawData")&&!(t.rawData&&typeof t.rawData.length=="number"||C.isString(t.rawData)))return"rawData: buffer expected";if(t.externalData!=null&&t.hasOwnProperty("externalData")){if(!Array.isArray(t.externalData))return"externalData: array expected";for(var o=0;o<t.externalData.length;++o){var i=A.onnx.StringStringEntryProto.verify(t.externalData[o]);if(i)return"externalData."+i}}if(t.dataLocation!=null&&t.hasOwnProperty("dataLocation"))switch(t.dataLocation){default:return"dataLocation: enum value expected";case 0:case 1:break}if(t.doubleData!=null&&t.hasOwnProperty("doubleData")){if(!Array.isArray(t.doubleData))return"doubleData: array expected";for(var o=0;o<t.doubleData.length;++o)if(typeof t.doubleData[o]!="number")return"doubleData: number[] expected"}if(t.uint64Data!=null&&t.hasOwnProperty("uint64Data")){if(!Array.isArray(t.uint64Data))return"uint64Data: array expected";for(var o=0;o<t.uint64Data.length;++o)if(!C.isInteger(t.uint64Data[o])&&!(t.uint64Data[o]&&C.isInteger(t.uint64Data[o].low)&&C.isInteger(t.uint64Data[o].high)))return"uint64Data: integer|Long[] expected"}return null},e.fromObject=function(t){if(t instanceof A.onnx.TensorProto)return t;var o=new A.onnx.TensorProto;if(t.dims){if(!Array.isArray(t.dims))throw TypeError(".onnx.TensorProto.dims: array expected");o.dims=[];for(var i=0;i<t.dims.length;++i)C.Long?(o.dims[i]=C.Long.fromValue(t.dims[i])).unsigned=!1:typeof t.dims[i]=="string"?o.dims[i]=parseInt(t.dims[i],10):typeof t.dims[i]=="number"?o.dims[i]=t.dims[i]:typeof t.dims[i]=="object"&&(o.dims[i]=new C.LongBits(t.dims[i].low>>>0,t.dims[i].high>>>0).toNumber())}if(t.dataType!=null&&(o.dataType=t.dataType|0),t.segment!=null){if(typeof t.segment!="object")throw TypeError(".onnx.TensorProto.segment: object expected");o.segment=A.onnx.TensorProto.Segment.fromObject(t.segment)}if(t.floatData){if(!Array.isArray(t.floatData))throw TypeError(".onnx.TensorProto.floatData: array expected");o.floatData=[];for(var i=0;i<t.floatData.length;++i)o.floatData[i]=Number(t.floatData[i])}if(t.int32Data){if(!Array.isArray(t.int32Data))throw TypeError(".onnx.TensorProto.int32Data: array expected");o.int32Data=[];for(var i=0;i<t.int32Data.length;++i)o.int32Data[i]=t.int32Data[i]|0}if(t.stringData){if(!Array.isArray(t.stringData))throw TypeError(".onnx.TensorProto.stringData: array expected");o.stringData=[];for(var i=0;i<t.stringData.length;++i)typeof t.stringData[i]=="string"?C.base64.decode(t.stringData[i],o.stringData[i]=C.newBuffer(C.base64.length(t.stringData[i])),0):t.stringData[i].length>=0&&(o.stringData[i]=t.stringData[i])}if(t.int64Data){if(!Array.isArray(t.int64Data))throw TypeError(".onnx.TensorProto.int64Data: array expected");o.int64Data=[];for(var i=0;i<t.int64Data.length;++i)C.Long?(o.int64Data[i]=C.Long.fromValue(t.int64Data[i])).unsigned=!1:typeof t.int64Data[i]=="string"?o.int64Data[i]=parseInt(t.int64Data[i],10):typeof t.int64Data[i]=="number"?o.int64Data[i]=t.int64Data[i]:typeof t.int64Data[i]=="object"&&(o.int64Data[i]=new C.LongBits(t.int64Data[i].low>>>0,t.int64Data[i].high>>>0).toNumber())}if(t.name!=null&&(o.name=String(t.name)),t.docString!=null&&(o.docString=String(t.docString)),t.rawData!=null&&(typeof t.rawData=="string"?C.base64.decode(t.rawData,o.rawData=C.newBuffer(C.base64.length(t.rawData)),0):t.rawData.length>=0&&(o.rawData=t.rawData)),t.externalData){if(!Array.isArray(t.externalData))throw TypeError(".onnx.TensorProto.externalData: array expected");o.externalData=[];for(var i=0;i<t.externalData.length;++i){if(typeof t.externalData[i]!="object")throw TypeError(".onnx.TensorProto.externalData: object expected");o.externalData[i]=A.onnx.StringStringEntryProto.fromObject(t.externalData[i])}}switch(t.dataLocation){default:if(typeof t.dataLocation=="number"){o.dataLocation=t.dataLocation;break}break;case"DEFAULT":case 0:o.dataLocation=0;break;case"EXTERNAL":case 1:o.dataLocation=1;break}if(t.doubleData){if(!Array.isArray(t.doubleData))throw TypeError(".onnx.TensorProto.doubleData: array expected");o.doubleData=[];for(var i=0;i<t.doubleData.length;++i)o.doubleData[i]=Number(t.doubleData[i])}if(t.uint64Data){if(!Array.isArray(t.uint64Data))throw TypeError(".onnx.TensorProto.uint64Data: array expected");o.uint64Data=[];for(var i=0;i<t.uint64Data.length;++i)C.Long?(o.uint64Data[i]=C.Long.fromValue(t.uint64Data[i])).unsigned=!0:typeof t.uint64Data[i]=="string"?o.uint64Data[i]=parseInt(t.uint64Data[i],10):typeof t.uint64Data[i]=="number"?o.uint64Data[i]=t.uint64Data[i]:typeof t.uint64Data[i]=="object"&&(o.uint64Data[i]=new C.LongBits(t.uint64Data[i].low>>>0,t.uint64Data[i].high>>>0).toNumber(!0))}return o},e.toObject=function(t,o){o||(o={});var i={};if((o.arrays||o.defaults)&&(i.dims=[],i.floatData=[],i.int32Data=[],i.stringData=[],i.int64Data=[],i.doubleData=[],i.uint64Data=[],i.externalData=[]),o.defaults&&(i.dataType=0,i.segment=null,i.name="",o.bytes===String?i.rawData="":(i.rawData=[],o.bytes!==Array&&(i.rawData=C.newBuffer(i.rawData))),i.docString="",i.dataLocation=o.enums===String?"DEFAULT":0),t.dims&&t.dims.length){i.dims=[];for(var a=0;a<t.dims.length;++a)typeof t.dims[a]=="number"?i.dims[a]=o.longs===String?String(t.dims[a]):t.dims[a]:i.dims[a]=o.longs===String?C.Long.prototype.toString.call(t.dims[a]):o.longs===Number?new C.LongBits(t.dims[a].low>>>0,t.dims[a].high>>>0).toNumber():t.dims[a]}if(t.dataType!=null&&t.hasOwnProperty("dataType")&&(i.dataType=t.dataType),t.segment!=null&&t.hasOwnProperty("segment")&&(i.segment=A.onnx.TensorProto.Segment.toObject(t.segment,o)),t.floatData&&t.floatData.length){i.floatData=[];for(var a=0;a<t.floatData.length;++a)i.floatData[a]=o.json&&!isFinite(t.floatData[a])?String(t.floatData[a]):t.floatData[a]}if(t.int32Data&&t.int32Data.length){i.int32Data=[];for(var a=0;a<t.int32Data.length;++a)i.int32Data[a]=t.int32Data[a]}if(t.stringData&&t.stringData.length){i.stringData=[];for(var a=0;a<t.stringData.length;++a)i.stringData[a]=o.bytes===String?C.base64.encode(t.stringData[a],0,t.stringData[a].length):o.bytes===Array?Array.prototype.slice.call(t.stringData[a]):t.stringData[a]}if(t.int64Data&&t.int64Data.length){i.int64Data=[];for(var a=0;a<t.int64Data.length;++a)typeof t.int64Data[a]=="number"?i.int64Data[a]=o.longs===String?String(t.int64Data[a]):t.int64Data[a]:i.int64Data[a]=o.longs===String?C.Long.prototype.toString.call(t.int64Data[a]):o.longs===Number?new C.LongBits(t.int64Data[a].low>>>0,t.int64Data[a].high>>>0).toNumber():t.int64Data[a]}if(t.name!=null&&t.hasOwnProperty("name")&&(i.name=t.name),t.rawData!=null&&t.hasOwnProperty("rawData")&&(i.rawData=o.bytes===String?C.base64.encode(t.rawData,0,t.rawData.length):o.bytes===Array?Array.prototype.slice.call(t.rawData):t.rawData),t.doubleData&&t.doubleData.length){i.doubleData=[];for(var a=0;a<t.doubleData.length;++a)i.doubleData[a]=o.json&&!isFinite(t.doubleData[a])?String(t.doubleData[a]):t.doubleData[a]}if(t.uint64Data&&t.uint64Data.length){i.uint64Data=[];for(var a=0;a<t.uint64Data.length;++a)typeof t.uint64Data[a]=="number"?i.uint64Data[a]=o.longs===String?String(t.uint64Data[a]):t.uint64Data[a]:i.uint64Data[a]=o.longs===String?C.Long.prototype.toString.call(t.uint64Data[a]):o.longs===Number?new C.LongBits(t.uint64Data[a].low>>>0,t.uint64Data[a].high>>>0).toNumber(!0):t.uint64Data[a]}if(t.docString!=null&&t.hasOwnProperty("docString")&&(i.docString=t.docString),t.externalData&&t.externalData.length){i.externalData=[];for(var a=0;a<t.externalData.length;++a)i.externalData[a]=A.onnx.StringStringEntryProto.toObject(t.externalData[a],o)}return t.dataLocation!=null&&t.hasOwnProperty("dataLocation")&&(i.dataLocation=o.enums===String?A.onnx.TensorProto.DataLocation[t.dataLocation]===void 0?t.dataLocation:A.onnx.TensorProto.DataLocation[t.dataLocation]:t.dataLocation),i},e.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},e.getTypeUrl=function(t){return t===void 0&&(t="type.googleapis.com"),t+"/onnx.TensorProto"},e.DataType=(function(){var n={},t=Object.create(n);return t[n[0]="UNDEFINED"]=0,t[n[1]="FLOAT"]=1,t[n[2]="UINT8"]=2,t[n[3]="INT8"]=3,t[n[4]="UINT16"]=4,t[n[5]="INT16"]=5,t[n[6]="INT32"]=6,t[n[7]="INT64"]=7,t[n[8]="STRING"]=8,t[n[9]="BOOL"]=9,t[n[10]="FLOAT16"]=10,t[n[11]="DOUBLE"]=11,t[n[12]="UINT32"]=12,t[n[13]="UINT64"]=13,t[n[14]="COMPLEX64"]=14,t[n[15]="COMPLEX128"]=15,t[n[16]="BFLOAT16"]=16,t[n[17]="FLOAT8E4M3FN"]=17,t[n[18]="FLOAT8E4M3FNUZ"]=18,t[n[19]="FLOAT8E5M2"]=19,t[n[20]="FLOAT8E5M2FNUZ"]=20,t})(),e.Segment=(function(){function n(t){if(t)for(var o=Object.keys(t),i=0;i<o.length;++i)t[o[i]]!=null&&(this[o[i]]=t[o[i]])}return n.prototype.begin=C.Long?C.Long.fromBits(0,0,!1):0,n.prototype.end=C.Long?C.Long.fromBits(0,0,!1):0,n.create=function(o){return new n(o)},n.encode=function(o,i){return i||(i=rt.create()),o.begin!=null&&Object.hasOwnProperty.call(o,"begin")&&i.uint32(8).int64(o.begin),o.end!=null&&Object.hasOwnProperty.call(o,"end")&&i.uint32(16).int64(o.end),i},n.encodeDelimited=function(o,i){return this.encode(o,i).ldelim()},n.decode=function(o,i){o instanceof Q||(o=Q.create(o));for(var a=i===void 0?o.len:o.pos+i,s=new A.onnx.TensorProto.Segment;o.pos<a;){var u=o.uint32();switch(u>>>3){case 1:{s.begin=o.int64();break}case 2:{s.end=o.int64();break}default:o.skipType(u&7);break}}return s},n.decodeDelimited=function(o){return o instanceof Q||(o=new Q(o)),this.decode(o,o.uint32())},n.verify=function(o){return typeof o!="object"||o===null?"object expected":o.begin!=null&&o.hasOwnProperty("begin")&&!C.isInteger(o.begin)&&!(o.begin&&C.isInteger(o.begin.low)&&C.isInteger(o.begin.high))?"begin: integer|Long expected":o.end!=null&&o.hasOwnProperty("end")&&!C.isInteger(o.end)&&!(o.end&&C.isInteger(o.end.low)&&C.isInteger(o.end.high))?"end: integer|Long expected":null},n.fromObject=function(o){if(o instanceof A.onnx.TensorProto.Segment)return o;var i=new A.onnx.TensorProto.Segment;return o.begin!=null&&(C.Long?(i.begin=C.Long.fromValue(o.begin)).unsigned=!1:typeof o.begin=="string"?i.begin=parseInt(o.begin,10):typeof o.begin=="number"?i.begin=o.begin:typeof o.begin=="object"&&(i.begin=new C.LongBits(o.begin.low>>>0,o.begin.high>>>0).toNumber())),o.end!=null&&(C.Long?(i.end=C.Long.fromValue(o.end)).unsigned=!1:typeof o.end=="string"?i.end=parseInt(o.end,10):typeof o.end=="number"?i.end=o.end:typeof o.end=="object"&&(i.end=new C.LongBits(o.end.low>>>0,o.end.high>>>0).toNumber())),i},n.toObject=function(o,i){i||(i={});var a={};if(i.defaults){if(C.Long){var s=new C.Long(0,0,!1);a.begin=i.longs===String?s.toString():i.longs===Number?s.toNumber():s}else a.begin=i.longs===String?"0":0;if(C.Long){var s=new C.Long(0,0,!1);a.end=i.longs===String?s.toString():i.longs===Number?s.toNumber():s}else a.end=i.longs===String?"0":0}return o.begin!=null&&o.hasOwnProperty("begin")&&(typeof o.begin=="number"?a.begin=i.longs===String?String(o.begin):o.begin:a.begin=i.longs===String?C.Long.prototype.toString.call(o.begin):i.longs===Number?new C.LongBits(o.begin.low>>>0,o.begin.high>>>0).toNumber():o.begin),o.end!=null&&o.hasOwnProperty("end")&&(typeof o.end=="number"?a.end=i.longs===String?String(o.end):o.end:a.end=i.longs===String?C.Long.prototype.toString.call(o.end):i.longs===Number?new C.LongBits(o.end.low>>>0,o.end.high>>>0).toNumber():o.end),a},n.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},n.getTypeUrl=function(o){return o===void 0&&(o="type.googleapis.com"),o+"/onnx.TensorProto.Segment"},n})(),e.DataLocation=(function(){var n={},t=Object.create(n);return t[n[0]="DEFAULT"]=0,t[n[1]="EXTERNAL"]=1,t})(),e})(),r.SparseTensorProto=(function(){function e(n){if(this.dims=[],n)for(var t=Object.keys(n),o=0;o<t.length;++o)n[t[o]]!=null&&(this[t[o]]=n[t[o]])}return e.prototype.values=null,e.prototype.indices=null,e.prototype.dims=C.emptyArray,e.create=function(t){return new e(t)},e.encode=function(t,o){if(o||(o=rt.create()),t.values!=null&&Object.hasOwnProperty.call(t,"values")&&A.onnx.TensorProto.encode(t.values,o.uint32(10).fork()).ldelim(),t.indices!=null&&Object.hasOwnProperty.call(t,"indices")&&A.onnx.TensorProto.encode(t.indices,o.uint32(18).fork()).ldelim(),t.dims!=null&&t.dims.length){o.uint32(26).fork();for(var i=0;i<t.dims.length;++i)o.int64(t.dims[i]);o.ldelim()}return o},e.encodeDelimited=function(t,o){return this.encode(t,o).ldelim()},e.decode=function(t,o){t instanceof Q||(t=Q.create(t));for(var i=o===void 0?t.len:t.pos+o,a=new A.onnx.SparseTensorProto;t.pos<i;){var s=t.uint32();switch(s>>>3){case 1:{a.values=A.onnx.TensorProto.decode(t,t.uint32());break}case 2:{a.indices=A.onnx.TensorProto.decode(t,t.uint32());break}case 3:{if(a.dims&&a.dims.length||(a.dims=[]),(s&7)===2)for(var u=t.uint32()+t.pos;t.pos<u;)a.dims.push(t.int64());else a.dims.push(t.int64());break}default:t.skipType(s&7);break}}return a},e.decodeDelimited=function(t){return t instanceof Q||(t=new Q(t)),this.decode(t,t.uint32())},e.verify=function(t){if(typeof t!="object"||t===null)return"object expected";if(t.values!=null&&t.hasOwnProperty("values")){var o=A.onnx.TensorProto.verify(t.values);if(o)return"values."+o}if(t.indices!=null&&t.hasOwnProperty("indices")){var o=A.onnx.TensorProto.verify(t.indices);if(o)return"indices."+o}if(t.dims!=null&&t.hasOwnProperty("dims")){if(!Array.isArray(t.dims))return"dims: array expected";for(var i=0;i<t.dims.length;++i)if(!C.isInteger(t.dims[i])&&!(t.dims[i]&&C.isInteger(t.dims[i].low)&&C.isInteger(t.dims[i].high)))return"dims: integer|Long[] expected"}return null},e.fromObject=function(t){if(t instanceof A.onnx.SparseTensorProto)return t;var o=new A.onnx.SparseTensorProto;if(t.values!=null){if(typeof t.values!="object")throw TypeError(".onnx.SparseTensorProto.values: object expected");o.values=A.onnx.TensorProto.fromObject(t.values)}if(t.indices!=null){if(typeof t.indices!="object")throw TypeError(".onnx.SparseTensorProto.indices: object expected");o.indices=A.onnx.TensorProto.fromObject(t.indices)}if(t.dims){if(!Array.isArray(t.dims))throw TypeError(".onnx.SparseTensorProto.dims: array expected");o.dims=[];for(var i=0;i<t.dims.length;++i)C.Long?(o.dims[i]=C.Long.fromValue(t.dims[i])).unsigned=!1:typeof t.dims[i]=="string"?o.dims[i]=parseInt(t.dims[i],10):typeof t.dims[i]=="number"?o.dims[i]=t.dims[i]:typeof t.dims[i]=="object"&&(o.dims[i]=new C.LongBits(t.dims[i].low>>>0,t.dims[i].high>>>0).toNumber())}return o},e.toObject=function(t,o){o||(o={});var i={};if((o.arrays||o.defaults)&&(i.dims=[]),o.defaults&&(i.values=null,i.indices=null),t.values!=null&&t.hasOwnProperty("values")&&(i.values=A.onnx.TensorProto.toObject(t.values,o)),t.indices!=null&&t.hasOwnProperty("indices")&&(i.indices=A.onnx.TensorProto.toObject(t.indices,o)),t.dims&&t.dims.length){i.dims=[];for(var a=0;a<t.dims.length;++a)typeof t.dims[a]=="number"?i.dims[a]=o.longs===String?String(t.dims[a]):t.dims[a]:i.dims[a]=o.longs===String?C.Long.prototype.toString.call(t.dims[a]):o.longs===Number?new C.LongBits(t.dims[a].low>>>0,t.dims[a].high>>>0).toNumber():t.dims[a]}return i},e.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},e.getTypeUrl=function(t){return t===void 0&&(t="type.googleapis.com"),t+"/onnx.SparseTensorProto"},e})(),r.TensorShapeProto=(function(){function e(n){if(this.dim=[],n)for(var t=Object.keys(n),o=0;o<t.length;++o)n[t[o]]!=null&&(this[t[o]]=n[t[o]])}return e.prototype.dim=C.emptyArray,e.create=function(t){return new e(t)},e.encode=function(t,o){if(o||(o=rt.create()),t.dim!=null&&t.dim.length)for(var i=0;i<t.dim.length;++i)A.onnx.TensorShapeProto.Dimension.encode(t.dim[i],o.uint32(10).fork()).ldelim();return o},e.encodeDelimited=function(t,o){return this.encode(t,o).ldelim()},e.decode=function(t,o){t instanceof Q||(t=Q.create(t));for(var i=o===void 0?t.len:t.pos+o,a=new A.onnx.TensorShapeProto;t.pos<i;){var s=t.uint32();switch(s>>>3){case 1:{a.dim&&a.dim.length||(a.dim=[]),a.dim.push(A.onnx.TensorShapeProto.Dimension.decode(t,t.uint32()));break}default:t.skipType(s&7);break}}return a},e.decodeDelimited=function(t){return t instanceof Q||(t=new Q(t)),this.decode(t,t.uint32())},e.verify=function(t){if(typeof t!="object"||t===null)return"object expected";if(t.dim!=null&&t.hasOwnProperty("dim")){if(!Array.isArray(t.dim))return"dim: array expected";for(var o=0;o<t.dim.length;++o){var i=A.onnx.TensorShapeProto.Dimension.verify(t.dim[o]);if(i)return"dim."+i}}return null},e.fromObject=function(t){if(t instanceof A.onnx.TensorShapeProto)return t;var o=new A.onnx.TensorShapeProto;if(t.dim){if(!Array.isArray(t.dim))throw TypeError(".onnx.TensorShapeProto.dim: array expected");o.dim=[];for(var i=0;i<t.dim.length;++i){if(typeof t.dim[i]!="object")throw TypeError(".onnx.TensorShapeProto.dim: object expected");o.dim[i]=A.onnx.TensorShapeProto.Dimension.fromObject(t.dim[i])}}return o},e.toObject=function(t,o){o||(o={});var i={};if((o.arrays||o.defaults)&&(i.dim=[]),t.dim&&t.dim.length){i.dim=[];for(var a=0;a<t.dim.length;++a)i.dim[a]=A.onnx.TensorShapeProto.Dimension.toObject(t.dim[a],o)}return i},e.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},e.getTypeUrl=function(t){return t===void 0&&(t="type.googleapis.com"),t+"/onnx.TensorShapeProto"},e.Dimension=(function(){function n(o){if(o)for(var i=Object.keys(o),a=0;a<i.length;++a)o[i[a]]!=null&&(this[i[a]]=o[i[a]])}n.prototype.dimValue=null,n.prototype.dimParam=null,n.prototype.denotation="";var t;return Object.defineProperty(n.prototype,"value",{get:C.oneOfGetter(t=["dimValue","dimParam"]),set:C.oneOfSetter(t)}),n.create=function(i){return new n(i)},n.encode=function(i,a){return a||(a=rt.create()),i.dimValue!=null&&Object.hasOwnProperty.call(i,"dimValue")&&a.uint32(8).int64(i.dimValue),i.dimParam!=null&&Object.hasOwnProperty.call(i,"dimParam")&&a.uint32(18).string(i.dimParam),i.denotation!=null&&Object.hasOwnProperty.call(i,"denotation")&&a.uint32(26).string(i.denotation),a},n.encodeDelimited=function(i,a){return this.encode(i,a).ldelim()},n.decode=function(i,a){i instanceof Q||(i=Q.create(i));for(var s=a===void 0?i.len:i.pos+a,u=new A.onnx.TensorShapeProto.Dimension;i.pos<s;){var l=i.uint32();switch(l>>>3){case 1:{u.dimValue=i.int64();break}case 2:{u.dimParam=i.string();break}case 3:{u.denotation=i.string();break}default:i.skipType(l&7);break}}return u},n.decodeDelimited=function(i){return i instanceof Q||(i=new Q(i)),this.decode(i,i.uint32())},n.verify=function(i){if(typeof i!="object"||i===null)return"object expected";var a={};if(i.dimValue!=null&&i.hasOwnProperty("dimValue")&&(a.value=1,!C.isInteger(i.dimValue)&&!(i.dimValue&&C.isInteger(i.dimValue.low)&&C.isInteger(i.dimValue.high))))return"dimValue: integer|Long expected";if(i.dimParam!=null&&i.hasOwnProperty("dimParam")){if(a.value===1)return"value: multiple values";if(a.value=1,!C.isString(i.dimParam))return"dimParam: string expected"}return i.denotation!=null&&i.hasOwnProperty("denotation")&&!C.isString(i.denotation)?"denotation: string expected":null},n.fromObject=function(i){if(i instanceof A.onnx.TensorShapeProto.Dimension)return i;var a=new A.onnx.TensorShapeProto.Dimension;return i.dimValue!=null&&(C.Long?(a.dimValue=C.Long.fromValue(i.dimValue)).unsigned=!1:typeof i.dimValue=="string"?a.dimValue=parseInt(i.dimValue,10):typeof i.dimValue=="number"?a.dimValue=i.dimValue:typeof i.dimValue=="object"&&(a.dimValue=new C.LongBits(i.dimValue.low>>>0,i.dimValue.high>>>0).toNumber())),i.dimParam!=null&&(a.dimParam=String(i.dimParam)),i.denotation!=null&&(a.denotation=String(i.denotation)),a},n.toObject=function(i,a){a||(a={});var s={};return a.defaults&&(s.denotation=""),i.dimValue!=null&&i.hasOwnProperty("dimValue")&&(typeof i.dimValue=="number"?s.dimValue=a.longs===String?String(i.dimValue):i.dimValue:s.dimValue=a.longs===String?C.Long.prototype.toString.call(i.dimValue):a.longs===Number?new C.LongBits(i.dimValue.low>>>0,i.dimValue.high>>>0).toNumber():i.dimValue,a.oneofs&&(s.value="dimValue")),i.dimParam!=null&&i.hasOwnProperty("dimParam")&&(s.dimParam=i.dimParam,a.oneofs&&(s.value="dimParam")),i.denotation!=null&&i.hasOwnProperty("denotation")&&(s.denotation=i.denotation),s},n.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},n.getTypeUrl=function(i){return i===void 0&&(i="type.googleapis.com"),i+"/onnx.TensorShapeProto.Dimension"},n})(),e})(),r.TypeProto=(function(){function e(t){if(t)for(var o=Object.keys(t),i=0;i<o.length;++i)t[o[i]]!=null&&(this[o[i]]=t[o[i]])}e.prototype.tensorType=null,e.prototype.sequenceType=null,e.prototype.mapType=null,e.prototype.optionalType=null,e.prototype.sparseTensorType=null,e.prototype.denotation="";var n;return Object.defineProperty(e.prototype,"value",{get:C.oneOfGetter(n=["tensorType","sequenceType","mapType","optionalType","sparseTensorType"]),set:C.oneOfSetter(n)}),e.create=function(o){return new e(o)},e.encode=function(o,i){return i||(i=rt.create()),o.tensorType!=null&&Object.hasOwnProperty.call(o,"tensorType")&&A.onnx.TypeProto.Tensor.encode(o.tensorType,i.uint32(10).fork()).ldelim(),o.sequenceType!=null&&Object.hasOwnProperty.call(o,"sequenceType")&&A.onnx.TypeProto.Sequence.encode(o.sequenceType,i.uint32(34).fork()).ldelim(),o.mapType!=null&&Object.hasOwnProperty.call(o,"mapType")&&A.onnx.TypeProto.Map.encode(o.mapType,i.uint32(42).fork()).ldelim(),o.denotation!=null&&Object.hasOwnProperty.call(o,"denotation")&&i.uint32(50).string(o.denotation),o.sparseTensorType!=null&&Object.hasOwnProperty.call(o,"sparseTensorType")&&A.onnx.TypeProto.SparseTensor.encode(o.sparseTensorType,i.uint32(66).fork()).ldelim(),o.optionalType!=null&&Object.hasOwnProperty.call(o,"optionalType")&&A.onnx.TypeProto.Optional.encode(o.optionalType,i.uint32(74).fork()).ldelim(),i},e.encodeDelimited=function(o,i){return this.encode(o,i).ldelim()},e.decode=function(o,i){o instanceof Q||(o=Q.create(o));for(var a=i===void 0?o.len:o.pos+i,s=new A.onnx.TypeProto;o.pos<a;){var u=o.uint32();switch(u>>>3){case 1:{s.tensorType=A.onnx.TypeProto.Tensor.decode(o,o.uint32());break}case 4:{s.sequenceType=A.onnx.TypeProto.Sequence.decode(o,o.uint32());break}case 5:{s.mapType=A.onnx.TypeProto.Map.decode(o,o.uint32());break}case 9:{s.optionalType=A.onnx.TypeProto.Optional.decode(o,o.uint32());break}case 8:{s.sparseTensorType=A.onnx.TypeProto.SparseTensor.decode(o,o.uint32());break}case 6:{s.denotation=o.string();break}default:o.skipType(u&7);break}}return s},e.decodeDelimited=function(o){return o instanceof Q||(o=new Q(o)),this.decode(o,o.uint32())},e.verify=function(o){if(typeof o!="object"||o===null)return"object expected";var i={};if(o.tensorType!=null&&o.hasOwnProperty("tensorType")){i.value=1;{var a=A.onnx.TypeProto.Tensor.verify(o.tensorType);if(a)return"tensorType."+a}}if(o.sequenceType!=null&&o.hasOwnProperty("sequenceType")){if(i.value===1)return"value: multiple values";i.value=1;{var a=A.onnx.TypeProto.Sequence.verify(o.sequenceType);if(a)return"sequenceType."+a}}if(o.mapType!=null&&o.hasOwnProperty("mapType")){if(i.value===1)return"value: multiple values";i.value=1;{var a=A.onnx.TypeProto.Map.verify(o.mapType);if(a)return"mapType."+a}}if(o.optionalType!=null&&o.hasOwnProperty("optionalType")){if(i.value===1)return"value: multiple values";i.value=1;{var a=A.onnx.TypeProto.Optional.verify(o.optionalType);if(a)return"optionalType."+a}}if(o.sparseTensorType!=null&&o.hasOwnProperty("sparseTensorType")){if(i.value===1)return"value: multiple values";i.value=1;{var a=A.onnx.TypeProto.SparseTensor.verify(o.sparseTensorType);if(a)return"sparseTensorType."+a}}return o.denotation!=null&&o.hasOwnProperty("denotation")&&!C.isString(o.denotation)?"denotation: string expected":null},e.fromObject=function(o){if(o instanceof A.onnx.TypeProto)return o;var i=new A.onnx.TypeProto;if(o.tensorType!=null){if(typeof o.tensorType!="object")throw TypeError(".onnx.TypeProto.tensorType: object expected");i.tensorType=A.onnx.TypeProto.Tensor.fromObject(o.tensorType)}if(o.sequenceType!=null){if(typeof o.sequenceType!="object")throw TypeError(".onnx.TypeProto.sequenceType: object expected");i.sequenceType=A.onnx.TypeProto.Sequence.fromObject(o.sequenceType)}if(o.mapType!=null){if(typeof o.mapType!="object")throw TypeError(".onnx.TypeProto.mapType: object expected");i.mapType=A.onnx.TypeProto.Map.fromObject(o.mapType)}if(o.optionalType!=null){if(typeof o.optionalType!="object")throw TypeError(".onnx.TypeProto.optionalType: object expected");i.optionalType=A.onnx.TypeProto.Optional.fromObject(o.optionalType)}if(o.sparseTensorType!=null){if(typeof o.sparseTensorType!="object")throw TypeError(".onnx.TypeProto.sparseTensorType: object expected");i.sparseTensorType=A.onnx.TypeProto.SparseTensor.fromObject(o.sparseTensorType)}return o.denotation!=null&&(i.denotation=String(o.denotation)),i},e.toObject=function(o,i){i||(i={});var a={};return i.defaults&&(a.denotation=""),o.tensorType!=null&&o.hasOwnProperty("tensorType")&&(a.tensorType=A.onnx.TypeProto.Tensor.toObject(o.tensorType,i),i.oneofs&&(a.value="tensorType")),o.sequenceType!=null&&o.hasOwnProperty("sequenceType")&&(a.sequenceType=A.onnx.TypeProto.Sequence.toObject(o.sequenceType,i),i.oneofs&&(a.value="sequenceType")),o.mapType!=null&&o.hasOwnProperty("mapType")&&(a.mapType=A.onnx.TypeProto.Map.toObject(o.mapType,i),i.oneofs&&(a.value="mapType")),o.denotation!=null&&o.hasOwnProperty("denotation")&&(a.denotation=o.denotation),o.sparseTensorType!=null&&o.hasOwnProperty("sparseTensorType")&&(a.sparseTensorType=A.onnx.TypeProto.SparseTensor.toObject(o.sparseTensorType,i),i.oneofs&&(a.value="sparseTensorType")),o.optionalType!=null&&o.hasOwnProperty("optionalType")&&(a.optionalType=A.onnx.TypeProto.Optional.toObject(o.optionalType,i),i.oneofs&&(a.value="optionalType")),a},e.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},e.getTypeUrl=function(o){return o===void 0&&(o="type.googleapis.com"),o+"/onnx.TypeProto"},e.Tensor=(function(){function t(o){if(o)for(var i=Object.keys(o),a=0;a<i.length;++a)o[i[a]]!=null&&(this[i[a]]=o[i[a]])}return t.prototype.elemType=0,t.prototype.shape=null,t.create=function(i){return new t(i)},t.encode=function(i,a){return a||(a=rt.create()),i.elemType!=null&&Object.hasOwnProperty.call(i,"elemType")&&a.uint32(8).int32(i.elemType),i.shape!=null&&Object.hasOwnProperty.call(i,"shape")&&A.onnx.TensorShapeProto.encode(i.shape,a.uint32(18).fork()).ldelim(),a},t.encodeDelimited=function(i,a){return this.encode(i,a).ldelim()},t.decode=function(i,a){i instanceof Q||(i=Q.create(i));for(var s=a===void 0?i.len:i.pos+a,u=new A.onnx.TypeProto.Tensor;i.pos<s;){var l=i.uint32();switch(l>>>3){case 1:{u.elemType=i.int32();break}case 2:{u.shape=A.onnx.TensorShapeProto.decode(i,i.uint32());break}default:i.skipType(l&7);break}}return u},t.decodeDelimited=function(i){return i instanceof Q||(i=new Q(i)),this.decode(i,i.uint32())},t.verify=function(i){if(typeof i!="object"||i===null)return"object expected";if(i.elemType!=null&&i.hasOwnProperty("elemType")&&!C.isInteger(i.elemType))return"elemType: integer expected";if(i.shape!=null&&i.hasOwnProperty("shape")){var a=A.onnx.TensorShapeProto.verify(i.shape);if(a)return"shape."+a}return null},t.fromObject=function(i){if(i instanceof A.onnx.TypeProto.Tensor)return i;var a=new A.onnx.TypeProto.Tensor;if(i.elemType!=null&&(a.elemType=i.elemType|0),i.shape!=null){if(typeof i.shape!="object")throw TypeError(".onnx.TypeProto.Tensor.shape: object expected");a.shape=A.onnx.TensorShapeProto.fromObject(i.shape)}return a},t.toObject=function(i,a){a||(a={});var s={};return a.defaults&&(s.elemType=0,s.shape=null),i.elemType!=null&&i.hasOwnProperty("elemType")&&(s.elemType=i.elemType),i.shape!=null&&i.hasOwnProperty("shape")&&(s.shape=A.onnx.TensorShapeProto.toObject(i.shape,a)),s},t.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},t.getTypeUrl=function(i){return i===void 0&&(i="type.googleapis.com"),i+"/onnx.TypeProto.Tensor"},t})(),e.Sequence=(function(){function t(o){if(o)for(var i=Object.keys(o),a=0;a<i.length;++a)o[i[a]]!=null&&(this[i[a]]=o[i[a]])}return t.prototype.elemType=null,t.create=function(i){return new t(i)},t.encode=function(i,a){return a||(a=rt.create()),i.elemType!=null&&Object.hasOwnProperty.call(i,"elemType")&&A.onnx.TypeProto.encode(i.elemType,a.uint32(10).fork()).ldelim(),a},t.encodeDelimited=function(i,a){return this.encode(i,a).ldelim()},t.decode=function(i,a){i instanceof Q||(i=Q.create(i));for(var s=a===void 0?i.len:i.pos+a,u=new A.onnx.TypeProto.Sequence;i.pos<s;){var l=i.uint32();switch(l>>>3){case 1:{u.elemType=A.onnx.TypeProto.decode(i,i.uint32());break}default:i.skipType(l&7);break}}return u},t.decodeDelimited=function(i){return i instanceof Q||(i=new Q(i)),this.decode(i,i.uint32())},t.verify=function(i){if(typeof i!="object"||i===null)return"object expected";if(i.elemType!=null&&i.hasOwnProperty("elemType")){var a=A.onnx.TypeProto.verify(i.elemType);if(a)return"elemType."+a}return null},t.fromObject=function(i){if(i instanceof A.onnx.TypeProto.Sequence)return i;var a=new A.onnx.TypeProto.Sequence;if(i.elemType!=null){if(typeof i.elemType!="object")throw TypeError(".onnx.TypeProto.Sequence.elemType: object expected");a.elemType=A.onnx.TypeProto.fromObject(i.elemType)}return a},t.toObject=function(i,a){a||(a={});var s={};return a.defaults&&(s.elemType=null),i.elemType!=null&&i.hasOwnProperty("elemType")&&(s.elemType=A.onnx.TypeProto.toObject(i.elemType,a)),s},t.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},t.getTypeUrl=function(i){return i===void 0&&(i="type.googleapis.com"),i+"/onnx.TypeProto.Sequence"},t})(),e.Map=(function(){function t(o){if(o)for(var i=Object.keys(o),a=0;a<i.length;++a)o[i[a]]!=null&&(this[i[a]]=o[i[a]])}return t.prototype.keyType=0,t.prototype.valueType=null,t.create=function(i){return new t(i)},t.encode=function(i,a){return a||(a=rt.create()),i.keyType!=null&&Object.hasOwnProperty.call(i,"keyType")&&a.uint32(8).int32(i.keyType),i.valueType!=null&&Object.hasOwnProperty.call(i,"valueType")&&A.onnx.TypeProto.encode(i.valueType,a.uint32(18).fork()).ldelim(),a},t.encodeDelimited=function(i,a){return this.encode(i,a).ldelim()},t.decode=function(i,a){i instanceof Q||(i=Q.create(i));for(var s=a===void 0?i.len:i.pos+a,u=new A.onnx.TypeProto.Map;i.pos<s;){var l=i.uint32();switch(l>>>3){case 1:{u.keyType=i.int32();break}case 2:{u.valueType=A.onnx.TypeProto.decode(i,i.uint32());break}default:i.skipType(l&7);break}}return u},t.decodeDelimited=function(i){return i instanceof Q||(i=new Q(i)),this.decode(i,i.uint32())},t.verify=function(i){if(typeof i!="object"||i===null)return"object expected";if(i.keyType!=null&&i.hasOwnProperty("keyType")&&!C.isInteger(i.keyType))return"keyType: integer expected";if(i.valueType!=null&&i.hasOwnProperty("valueType")){var a=A.onnx.TypeProto.verify(i.valueType);if(a)return"valueType."+a}return null},t.fromObject=function(i){if(i instanceof A.onnx.TypeProto.Map)return i;var a=new A.onnx.TypeProto.Map;if(i.keyType!=null&&(a.keyType=i.keyType|0),i.valueType!=null){if(typeof i.valueType!="object")throw TypeError(".onnx.TypeProto.Map.valueType: object expected");a.valueType=A.onnx.TypeProto.fromObject(i.valueType)}return a},t.toObject=function(i,a){a||(a={});var s={};return a.defaults&&(s.keyType=0,s.valueType=null),i.keyType!=null&&i.hasOwnProperty("keyType")&&(s.keyType=i.keyType),i.valueType!=null&&i.hasOwnProperty("valueType")&&(s.valueType=A.onnx.TypeProto.toObject(i.valueType,a)),s},t.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},t.getTypeUrl=function(i){return i===void 0&&(i="type.googleapis.com"),i+"/onnx.TypeProto.Map"},t})(),e.Optional=(function(){function t(o){if(o)for(var i=Object.keys(o),a=0;a<i.length;++a)o[i[a]]!=null&&(this[i[a]]=o[i[a]])}return t.prototype.elemType=null,t.create=function(i){return new t(i)},t.encode=function(i,a){return a||(a=rt.create()),i.elemType!=null&&Object.hasOwnProperty.call(i,"elemType")&&A.onnx.TypeProto.encode(i.elemType,a.uint32(10).fork()).ldelim(),a},t.encodeDelimited=function(i,a){return this.encode(i,a).ldelim()},t.decode=function(i,a){i instanceof Q||(i=Q.create(i));for(var s=a===void 0?i.len:i.pos+a,u=new A.onnx.TypeProto.Optional;i.pos<s;){var l=i.uint32();switch(l>>>3){case 1:{u.elemType=A.onnx.TypeProto.decode(i,i.uint32());break}default:i.skipType(l&7);break}}return u},t.decodeDelimited=function(i){return i instanceof Q||(i=new Q(i)),this.decode(i,i.uint32())},t.verify=function(i){if(typeof i!="object"||i===null)return"object expected";if(i.elemType!=null&&i.hasOwnProperty("elemType")){var a=A.onnx.TypeProto.verify(i.elemType);if(a)return"elemType."+a}return null},t.fromObject=function(i){if(i instanceof A.onnx.TypeProto.Optional)return i;var a=new A.onnx.TypeProto.Optional;if(i.elemType!=null){if(typeof i.elemType!="object")throw TypeError(".onnx.TypeProto.Optional.elemType: object expected");a.elemType=A.onnx.TypeProto.fromObject(i.elemType)}return a},t.toObject=function(i,a){a||(a={});var s={};return a.defaults&&(s.elemType=null),i.elemType!=null&&i.hasOwnProperty("elemType")&&(s.elemType=A.onnx.TypeProto.toObject(i.elemType,a)),s},t.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},t.getTypeUrl=function(i){return i===void 0&&(i="type.googleapis.com"),i+"/onnx.TypeProto.Optional"},t})(),e.SparseTensor=(function(){function t(o){if(o)for(var i=Object.keys(o),a=0;a<i.length;++a)o[i[a]]!=null&&(this[i[a]]=o[i[a]])}return t.prototype.elemType=0,t.prototype.shape=null,t.create=function(i){return new t(i)},t.encode=function(i,a){return a||(a=rt.create()),i.elemType!=null&&Object.hasOwnProperty.call(i,"elemType")&&a.uint32(8).int32(i.elemType),i.shape!=null&&Object.hasOwnProperty.call(i,"shape")&&A.onnx.TensorShapeProto.encode(i.shape,a.uint32(18).fork()).ldelim(),a},t.encodeDelimited=function(i,a){return this.encode(i,a).ldelim()},t.decode=function(i,a){i instanceof Q||(i=Q.create(i));for(var s=a===void 0?i.len:i.pos+a,u=new A.onnx.TypeProto.SparseTensor;i.pos<s;){var l=i.uint32();switch(l>>>3){case 1:{u.elemType=i.int32();break}case 2:{u.shape=A.onnx.TensorShapeProto.decode(i,i.uint32());break}default:i.skipType(l&7);break}}return u},t.decodeDelimited=function(i){return i instanceof Q||(i=new Q(i)),this.decode(i,i.uint32())},t.verify=function(i){if(typeof i!="object"||i===null)return"object expected";if(i.elemType!=null&&i.hasOwnProperty("elemType")&&!C.isInteger(i.elemType))return"elemType: integer expected";if(i.shape!=null&&i.hasOwnProperty("shape")){var a=A.onnx.TensorShapeProto.verify(i.shape);if(a)return"shape."+a}return null},t.fromObject=function(i){if(i instanceof A.onnx.TypeProto.SparseTensor)return i;var a=new A.onnx.TypeProto.SparseTensor;if(i.elemType!=null&&(a.elemType=i.elemType|0),i.shape!=null){if(typeof i.shape!="object")throw TypeError(".onnx.TypeProto.SparseTensor.shape: object expected");a.shape=A.onnx.TensorShapeProto.fromObject(i.shape)}return a},t.toObject=function(i,a){a||(a={});var s={};return a.defaults&&(s.elemType=0,s.shape=null),i.elemType!=null&&i.hasOwnProperty("elemType")&&(s.elemType=i.elemType),i.shape!=null&&i.hasOwnProperty("shape")&&(s.shape=A.onnx.TensorShapeProto.toObject(i.shape,a)),s},t.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},t.getTypeUrl=function(i){return i===void 0&&(i="type.googleapis.com"),i+"/onnx.TypeProto.SparseTensor"},t})(),e})(),r.OperatorSetIdProto=(function(){function e(n){if(n)for(var t=Object.keys(n),o=0;o<t.length;++o)n[t[o]]!=null&&(this[t[o]]=n[t[o]])}return e.prototype.domain="",e.prototype.version=C.Long?C.Long.fromBits(0,0,!1):0,e.create=function(t){return new e(t)},e.encode=function(t,o){return o||(o=rt.create()),t.domain!=null&&Object.hasOwnProperty.call(t,"domain")&&o.uint32(10).string(t.domain),t.version!=null&&Object.hasOwnProperty.call(t,"version")&&o.uint32(16).int64(t.version),o},e.encodeDelimited=function(t,o){return this.encode(t,o).ldelim()},e.decode=function(t,o){t instanceof Q||(t=Q.create(t));for(var i=o===void 0?t.len:t.pos+o,a=new A.onnx.OperatorSetIdProto;t.pos<i;){var s=t.uint32();switch(s>>>3){case 1:{a.domain=t.string();break}case 2:{a.version=t.int64();break}default:t.skipType(s&7);break}}return a},e.decodeDelimited=function(t){return t instanceof Q||(t=new Q(t)),this.decode(t,t.uint32())},e.verify=function(t){return typeof t!="object"||t===null?"object expected":t.domain!=null&&t.hasOwnProperty("domain")&&!C.isString(t.domain)?"domain: string expected":t.version!=null&&t.hasOwnProperty("version")&&!C.isInteger(t.version)&&!(t.version&&C.isInteger(t.version.low)&&C.isInteger(t.version.high))?"version: integer|Long expected":null},e.fromObject=function(t){if(t instanceof A.onnx.OperatorSetIdProto)return t;var o=new A.onnx.OperatorSetIdProto;return t.domain!=null&&(o.domain=String(t.domain)),t.version!=null&&(C.Long?(o.version=C.Long.fromValue(t.version)).unsigned=!1:typeof t.version=="string"?o.version=parseInt(t.version,10):typeof t.version=="number"?o.version=t.version:typeof t.version=="object"&&(o.version=new C.LongBits(t.version.low>>>0,t.version.high>>>0).toNumber())),o},e.toObject=function(t,o){o||(o={});var i={};if(o.defaults)if(i.domain="",C.Long){var a=new C.Long(0,0,!1);i.version=o.longs===String?a.toString():o.longs===Number?a.toNumber():a}else i.version=o.longs===String?"0":0;return t.domain!=null&&t.hasOwnProperty("domain")&&(i.domain=t.domain),t.version!=null&&t.hasOwnProperty("version")&&(typeof t.version=="number"?i.version=o.longs===String?String(t.version):t.version:i.version=o.longs===String?C.Long.prototype.toString.call(t.version):o.longs===Number?new C.LongBits(t.version.low>>>0,t.version.high>>>0).toNumber():t.version),i},e.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},e.getTypeUrl=function(t){return t===void 0&&(t="type.googleapis.com"),t+"/onnx.OperatorSetIdProto"},e})(),r.OperatorStatus=(function(){var e={},n=Object.create(e);return n[e[0]="EXPERIMENTAL"]=0,n[e[1]="STABLE"]=1,n})(),r.FunctionProto=(function(){function e(n){if(this.input=[],this.output=[],this.attribute=[],this.attributeProto=[],this.node=[],this.opsetImport=[],n)for(var t=Object.keys(n),o=0;o<t.length;++o)n[t[o]]!=null&&(this[t[o]]=n[t[o]])}return e.prototype.name="",e.prototype.input=C.emptyArray,e.prototype.output=C.emptyArray,e.prototype.attribute=C.emptyArray,e.prototype.attributeProto=C.emptyArray,e.prototype.node=C.emptyArray,e.prototype.docString="",e.prototype.opsetImport=C.emptyArray,e.prototype.domain="",e.create=function(t){return new e(t)},e.encode=function(t,o){if(o||(o=rt.create()),t.name!=null&&Object.hasOwnProperty.call(t,"name")&&o.uint32(10).string(t.name),t.input!=null&&t.input.length)for(var i=0;i<t.input.length;++i)o.uint32(34).string(t.input[i]);if(t.output!=null&&t.output.length)for(var i=0;i<t.output.length;++i)o.uint32(42).string(t.output[i]);if(t.attribute!=null&&t.attribute.length)for(var i=0;i<t.attribute.length;++i)o.uint32(50).string(t.attribute[i]);if(t.node!=null&&t.node.length)for(var i=0;i<t.node.length;++i)A.onnx.NodeProto.encode(t.node[i],o.uint32(58).fork()).ldelim();if(t.docString!=null&&Object.hasOwnProperty.call(t,"docString")&&o.uint32(66).string(t.docString),t.opsetImport!=null&&t.opsetImport.length)for(var i=0;i<t.opsetImport.length;++i)A.onnx.OperatorSetIdProto.encode(t.opsetImport[i],o.uint32(74).fork()).ldelim();if(t.domain!=null&&Object.hasOwnProperty.call(t,"domain")&&o.uint32(82).string(t.domain),t.attributeProto!=null&&t.attributeProto.length)for(var i=0;i<t.attributeProto.length;++i)A.onnx.AttributeProto.encode(t.attributeProto[i],o.uint32(90).fork()).ldelim();return o},e.encodeDelimited=function(t,o){return this.encode(t,o).ldelim()},e.decode=function(t,o){t instanceof Q||(t=Q.create(t));for(var i=o===void 0?t.len:t.pos+o,a=new A.onnx.FunctionProto;t.pos<i;){var s=t.uint32();switch(s>>>3){case 1:{a.name=t.string();break}case 4:{a.input&&a.input.length||(a.input=[]),a.input.push(t.string());break}case 5:{a.output&&a.output.length||(a.output=[]),a.output.push(t.string());break}case 6:{a.attribute&&a.attribute.length||(a.attribute=[]),a.attribute.push(t.string());break}case 11:{a.attributeProto&&a.attributeProto.length||(a.attributeProto=[]),a.attributeProto.push(A.onnx.AttributeProto.decode(t,t.uint32()));break}case 7:{a.node&&a.node.length||(a.node=[]),a.node.push(A.onnx.NodeProto.decode(t,t.uint32()));break}case 8:{a.docString=t.string();break}case 9:{a.opsetImport&&a.opsetImport.length||(a.opsetImport=[]),a.opsetImport.push(A.onnx.OperatorSetIdProto.decode(t,t.uint32()));break}case 10:{a.domain=t.string();break}default:t.skipType(s&7);break}}return a},e.decodeDelimited=function(t){return t instanceof Q||(t=new Q(t)),this.decode(t,t.uint32())},e.verify=function(t){if(typeof t!="object"||t===null)return"object expected";if(t.name!=null&&t.hasOwnProperty("name")&&!C.isString(t.name))return"name: string expected";if(t.input!=null&&t.hasOwnProperty("input")){if(!Array.isArray(t.input))return"input: array expected";for(var o=0;o<t.input.length;++o)if(!C.isString(t.input[o]))return"input: string[] expected"}if(t.output!=null&&t.hasOwnProperty("output")){if(!Array.isArray(t.output))return"output: array expected";for(var o=0;o<t.output.length;++o)if(!C.isString(t.output[o]))return"output: string[] expected"}if(t.attribute!=null&&t.hasOwnProperty("attribute")){if(!Array.isArray(t.attribute))return"attribute: array expected";for(var o=0;o<t.attribute.length;++o)if(!C.isString(t.attribute[o]))return"attribute: string[] expected"}if(t.attributeProto!=null&&t.hasOwnProperty("attributeProto")){if(!Array.isArray(t.attributeProto))return"attributeProto: array expected";for(var o=0;o<t.attributeProto.length;++o){var i=A.onnx.AttributeProto.verify(t.attributeProto[o]);if(i)return"attributeProto."+i}}if(t.node!=null&&t.hasOwnProperty("node")){if(!Array.isArray(t.node))return"node: array expected";for(var o=0;o<t.node.length;++o){var i=A.onnx.NodeProto.verify(t.node[o]);if(i)return"node."+i}}if(t.docString!=null&&t.hasOwnProperty("docString")&&!C.isString(t.docString))return"docString: string expected";if(t.opsetImport!=null&&t.hasOwnProperty("opsetImport")){if(!Array.isArray(t.opsetImport))return"opsetImport: array expected";for(var o=0;o<t.opsetImport.length;++o){var i=A.onnx.OperatorSetIdProto.verify(t.opsetImport[o]);if(i)return"opsetImport."+i}}return t.domain!=null&&t.hasOwnProperty("domain")&&!C.isString(t.domain)?"domain: string expected":null},e.fromObject=function(t){if(t instanceof A.onnx.FunctionProto)return t;var o=new A.onnx.FunctionProto;if(t.name!=null&&(o.name=String(t.name)),t.input){if(!Array.isArray(t.input))throw TypeError(".onnx.FunctionProto.input: array expected");o.input=[];for(var i=0;i<t.input.length;++i)o.input[i]=String(t.input[i])}if(t.output){if(!Array.isArray(t.output))throw TypeError(".onnx.FunctionProto.output: array expected");o.output=[];for(var i=0;i<t.output.length;++i)o.output[i]=String(t.output[i])}if(t.attribute){if(!Array.isArray(t.attribute))throw TypeError(".onnx.FunctionProto.attribute: array expected");o.attribute=[];for(var i=0;i<t.attribute.length;++i)o.attribute[i]=String(t.attribute[i])}if(t.attributeProto){if(!Array.isArray(t.attributeProto))throw TypeError(".onnx.FunctionProto.attributeProto: array expected");o.attributeProto=[];for(var i=0;i<t.attributeProto.length;++i){if(typeof t.attributeProto[i]!="object")throw TypeError(".onnx.FunctionProto.attributeProto: object expected");o.attributeProto[i]=A.onnx.AttributeProto.fromObject(t.attributeProto[i])}}if(t.node){if(!Array.isArray(t.node))throw TypeError(".onnx.FunctionProto.node: array expected");o.node=[];for(var i=0;i<t.node.length;++i){if(typeof t.node[i]!="object")throw TypeError(".onnx.FunctionProto.node: object expected");o.node[i]=A.onnx.NodeProto.fromObject(t.node[i])}}if(t.docString!=null&&(o.docString=String(t.docString)),t.opsetImport){if(!Array.isArray(t.opsetImport))throw TypeError(".onnx.FunctionProto.opsetImport: array expected");o.opsetImport=[];for(var i=0;i<t.opsetImport.length;++i){if(typeof t.opsetImport[i]!="object")throw TypeError(".onnx.FunctionProto.opsetImport: object expected");o.opsetImport[i]=A.onnx.OperatorSetIdProto.fromObject(t.opsetImport[i])}}return t.domain!=null&&(o.domain=String(t.domain)),o},e.toObject=function(t,o){o||(o={});var i={};if((o.arrays||o.defaults)&&(i.input=[],i.output=[],i.attribute=[],i.node=[],i.opsetImport=[],i.attributeProto=[]),o.defaults&&(i.name="",i.docString="",i.domain=""),t.name!=null&&t.hasOwnProperty("name")&&(i.name=t.name),t.input&&t.input.length){i.input=[];for(var a=0;a<t.input.length;++a)i.input[a]=t.input[a]}if(t.output&&t.output.length){i.output=[];for(var a=0;a<t.output.length;++a)i.output[a]=t.output[a]}if(t.attribute&&t.attribute.length){i.attribute=[];for(var a=0;a<t.attribute.length;++a)i.attribute[a]=t.attribute[a]}if(t.node&&t.node.length){i.node=[];for(var a=0;a<t.node.length;++a)i.node[a]=A.onnx.NodeProto.toObject(t.node[a],o)}if(t.docString!=null&&t.hasOwnProperty("docString")&&(i.docString=t.docString),t.opsetImport&&t.opsetImport.length){i.opsetImport=[];for(var a=0;a<t.opsetImport.length;++a)i.opsetImport[a]=A.onnx.OperatorSetIdProto.toObject(t.opsetImport[a],o)}if(t.domain!=null&&t.hasOwnProperty("domain")&&(i.domain=t.domain),t.attributeProto&&t.attributeProto.length){i.attributeProto=[];for(var a=0;a<t.attributeProto.length;++a)i.attributeProto[a]=A.onnx.AttributeProto.toObject(t.attributeProto[a],o)}return i},e.prototype.toJSON=function(){return this.constructor.toObject(this,Xe.util.toJSONOptions)},e.getTypeUrl=function(t){return t===void 0&&(t="type.googleapis.com"),t+"/onnx.FunctionProto"},e})(),r})();am.exports=A});function eo(r,e){if(!r)throw new Error(typeof e=="string"?e:e())}function Do(r){return new TextDecoder().decode(r)}var Ze,Er,Tl,bt,Gi,mt,Tt,ae,Co,Cr,Dr,kr,Be=L(()=>{"use strict";Fs();Ze=ve(Qr());Nr();Er=class{static arraysEqual(e,n){if(e.length!==n.length)return!1;for(let t=0;t<e.length;t++)if(e[t]!==n[t])return!1;return!0}},Tl=class{static preprocessInputShapes(e,n){let t=e.length===1?[1,e[0]]:e,o=n.length===1?[n[0],1]:n;return[t,o]}static postprocessOutputShape(e,n,t){n===1&&e.splice(e.length-2,1),t===1&&e.pop()}static calcMatMulShape(e,n){return e[1]!==n[0]?void 0:[e[0],n[1]]}},bt=class r{static calcShape(e,n,t=!1){let o=e.length,i=n.length;if(o===0)return n;if(i===0)return e;let a=Math.max(e.length,n.length),s=new Array(a);if(t){if(o<2||i<2)return;let u=Tl.calcMatMulShape([e[o-2],e[o-1]],[n[i-2],n[i-1]]);if(u===void 0)return;[s[a-2],s[a-1]]=u}for(let u=t?3:1;u<=a;u++){let l=o-u<0?1:e[o-u],d=i-u<0?1:n[i-u];if(l!==d&&l>1&&d>1)return;s[a-u]=Math.max(l,d)}return s}static index(e,n){let t=new Array(n.length);return r.fillIndex(e,n,t),t}static fillIndex(e,n,t){let o=e.length-n.length;for(let i=0;i<n.length;i++)t[i]=e[o+i]%n[i]}static calc(e,n,t,o,i){let a=r.calcShape(e.dims,n.dims);if(a){if(o&&!ae.areEqual(a,e.dims))return;let s=ae.size(a),u=o?e:new it(a,i||e.type);if(a.length===0)u.set([],t(e.get([]),n.get([])));else{let l=new Array(a.length),d=new Array(e.dims.length),p=new Array(n.dims.length),h=0,g=0,b=!1,_=!1;e.dims.length===0&&(h=e.get([]),b=!0),n.dims.length===0&&(g=n.get([]),_=!0);let S;for(let v=0;v<s;v++){S=v;for(let x=a.length-1;x>=0;x--)l[x]=S%a[x],S=Math.floor(S/a[x]);b||(r.fillIndex(l,e.dims,d),h=e.get(d)),_||(r.fillIndex(l,n.dims,p),g=n.get(p)),u.set(l,t(h,g))}}return u}}static isValidBroadcast(e,n){let t=e.length,o=n.length;if(t>o)return!1;for(let i=1;i<=t;i++)if(e[t-i]!==1&&e[t-i]!==n[o-i])return!1;return!0}static getBroadcastDims(e,n){let t=e.length,o=[];for(let i=0;i<t;i++){let a=t-1-i,s=e[a]||1;(n[n.length-1-i]||1)>1&&s===1&&o.unshift(a)}return o}},Gi=class{static getShapeOfGemmResult(e,n,t,o,i){if(e.length!==2||t.length!==2)throw new Error("shape need to be of size 2");let a,s,u;n?(a=e[1],s=e[0]):(a=e[0],s=e[1]);let l=-1;if(o?(u=t[0],l=1):(u=t[1],l=0),t[l]!==s)throw new Error("dimension mismatch");if(a<=0||u<=0||s<=0)throw new Error("invalid shape specified");if(i&&!bt.isValidBroadcast(i,[a,u]))throw new Error("gemm: invalid bias shape for broadcast");return[a,u,s]}},mt=class r{static tensorDataTypeFromProto(e){switch(e){case Ze.onnx.TensorProto.DataType.INT8:return"int8";case Ze.onnx.TensorProto.DataType.UINT8:return"uint8";case Ze.onnx.TensorProto.DataType.BOOL:return"bool";case Ze.onnx.TensorProto.DataType.INT16:return"int16";case Ze.onnx.TensorProto.DataType.UINT16:return"uint16";case Ze.onnx.TensorProto.DataType.INT32:return"int32";case Ze.onnx.TensorProto.DataType.UINT32:return"uint32";case Ze.onnx.TensorProto.DataType.FLOAT:return"float32";case Ze.onnx.TensorProto.DataType.DOUBLE:return"float64";case Ze.onnx.TensorProto.DataType.STRING:return"string";case Ze.onnx.TensorProto.DataType.INT64:return"int32";case Ze.onnx.TensorProto.DataType.UINT64:return"uint32";default:throw new Error(`unsupported data type: ${Ze.onnx.TensorProto.DataType[e]}`)}}static tensorDataTypeStringToEnum(e){switch(e){case"int8":return Ze.onnx.TensorProto.DataType.INT8;case"uint8":return Ze.onnx.TensorProto.DataType.UINT8;case"bool":return Ze.onnx.TensorProto.DataType.BOOL;case"int16":return Ze.onnx.TensorProto.DataType.INT16;case"uint16":return Ze.onnx.TensorProto.DataType.UINT16;case"int32":return Ze.onnx.TensorProto.DataType.INT32;case"uint32":return Ze.onnx.TensorProto.DataType.UINT32;case"float32":return Ze.onnx.TensorProto.DataType.FLOAT;case"float64":return Ze.onnx.TensorProto.DataType.DOUBLE;case"string":return Ze.onnx.TensorProto.DataType.STRING;case"int64":return Ze.onnx.TensorProto.DataType.INT64;case"uint64":return Ze.onnx.TensorProto.DataType.UINT64;default:throw new Error(`unsupported data type: ${e}`)}}static tensorDimsFromProto(e){return e.map(n=>cr.isLong(n)?n.toNumber():n)}static tensorValueTypeFromProto(e){return{tensorType:r.tensorDataTypeFromProto(e.elemType),shape:{dims:r.tensorDimsFromProto(e.shape.dim.map(n=>n.dimValue))}}}static tensorDimsFromORTFormat(e){let n=[];for(let t=0;t<e.dimsLength();t++)n.push(Tt.longToNumber(e.dims(t)));return n}static tensorAttributesFromORTFormat(e){let n=[];for(let t=0;t<e.attributesLength();t++)n.push(e.attributes(t));return n}},Tt=class{static longToNumber(e){return cr.isLong(e)?e.toNumber():typeof e=="bigint"?Number(e):e}static isLong(e){return cr.isLong(e)||typeof e=="bigint"}},ae=class r{static size(e){return r.getSizeFromDimensionRange(e,0,e.length)}static sizeFromDimension(e,n){if(n<0||n>e.length)throw new Error(`invalid dimension of ${n} for sizeFromDimension as Tensor has ${e.length} dimensions.`);return r.getSizeFromDimensionRange(e,n,e.length)}static sizeToDimension(e,n){if(n<0||n>e.length)throw new Error(`invalid dimension of ${n} for sizeToDimension as Tensor has ${e.length} dimensions.`);return r.getSizeFromDimensionRange(e,0,n)}static getSizeFromDimensionRange(e,n,t){let o=1;for(let i=n;i<t;i++){if(e[i]<=0)throw new Error("cannot get valid size from specified dimension range. Most likely the range contains 0 or negative values in them.");o*=e[i]}return o}static computeStrides(e){let n=e.length;if(n===0)return[];if(n===1)return[1];let t=new Array(n);t[n-1]=1,t[n-2]=e[n-1];for(let o=n-3;o>=0;--o)t[o]=t[o+1]*e[o+1];return t}static transpose(e){return e.slice().reverse()}static indicesToOffset(e,n,t){t===void 0&&(t=e.length);let o=0;for(let i=0;i<t;++i)o+=n[i]*e[i];return o}static offsetToIndices(e,n){let t=n.length;if(t===0)return[];if(t===1)return[e*n[0]];let o=new Array(n.length);for(let i=0;i<o.length-1;++i)o[i]=Math.floor(e/n[i]),e-=o[i]*n[i];return o[o.length-1]=e,o}static normalizeAxis(e,n){if(e<-n&&e>=n)throw new Error("unsupported axis for this operation.");return e<0?e+n:e}static normalizeAxes(e,n){return e.map(t=>this.normalizeAxis(t,n))}static incrementIndex(e,n,t){if(n.length===0||e.length===0)throw new Error("Index incrementing unsupported for scalar Tensor");if(t===void 0)t=n.length;else if(t<=0||t>n.length)throw new Error("Incorrect axis to increment on");for(let o=t-1;o>=0&&(e[o]++,!(e[o]<n[o]));--o)e[o]=0}static calculateReshapedDims(e,n){if(n.length===0){if(e.length===0||r.size(e)===1)return[];throw new Error("cannot reshape to a scalar Tensor")}let t=n.length,o=new Array(t),i=-1,a=1;for(let u=0;u<t;u++){if(n[u]<-1)throw new Error("a dimension in shape hints cannot be less than -1");if(n[u]===-1){if(i!==-1)throw new Error("at most one dimension in shape hints can be -1");i=u}else{if(n[u]===0){if(u>=e.length)throw new Error("the dimension with value zero exceeds the dimension size of the input tensor");o[u]=e[u]}else o[u]=n[u];a*=o[u]}}let s=r.size(e);if(i!==-1){if(s%a!==0)throw new Error(`the input tensor cannot be reshaped to the requested shape. Input shape: [${e}] Output shape: [${n}]`);o[i]=s/a}else if(a!==s)throw new Error("reshapedDims and originalDims don't have matching sizes");return o}static sortBasedOnPerm(e,n){return n?n.map(t=>e[t]):e.slice().reverse()}static padShape(e,n){let t=e.length;return e.map((o,i)=>o+n[i]+n[i+t])}static areEqual(e,n){return e.length!==n.length?!1:e.every((t,o)=>t===n[o])}static validateDimsAndCalcSize(e){if(e.length>6)throw new TypeError("Only rank 0 to 6 is supported for tensor shape.");let n=1;for(let t of e){if(!Number.isInteger(t))throw new TypeError(`Invalid shape: ${t} is not an integer`);if(t<0||t>2147483647)throw new TypeError(`Invalid shape: length ${t} is not allowed`);n*=t}return n}static flattenShape(e,n){n<0&&(n+=e.length);let t=e.reduce((a,s)=>a*s,1),o=e.slice(n).reduce((a,s)=>a*s,1);return[t/o,o]}static squeezeShape(e,n){let t=new Array;n=r.normalizeAxes(n,e.length);for(let o=0;o<e.length;o++){let i=n.indexOf(o)>=0;if(i&&e[o]!==1)throw new Error("squeeze an axis of size different than 1");(n.length===0&&e[o]>1||n.length>0&&!i)&&t.push(e[o])}return t}static unsqueezeShape(e,n){let t=new Array(e.length+n.length);t.fill(0);for(let i=0;i<n.length;i++){let a=r.normalizeAxis(n[i],t.length);if(a>=t.length)throw new Error("'axes' has an out of range axis");if(t[a]!==0)throw new Error("'axes' has a duplicate axis");t[a]=1}let o=0;for(let i=0;i<t.length;i++)t[i]===0&&(t[i]=e[o++]);if(o!==e.length)throw new Error("the unsqueezed dimension could not be established");return t}},Co=class r{static splitShape(e,n,t,o){if(t.length===0){if(!o)throw new Error("need to know number of outputs when the 'split' attribute is not specified");r.determineSplit(e[n],o,t)}let i=[],a=[0];for(let s=0;s<t.length;++s){s!==0&&a.push(a[s-1]+t[s-1]);let u=e.slice();u[n]=t[s],i.push(u)}return[i,a]}static determineSplit(e,n,t){if(e%n!==0)throw new Error("cannot split tensor to equal sized parts");for(let o=0;o<n;++o)t.push(e/n)}},Cr=class r{static adjustPoolAttributes(e,n,t,o,i,a){if(!e&&t.length!==n.length-2)throw new Error("length of specified kernel shapes should be 2 less than length of input dimensions");if(e)for(let s=0;s<n.length-2;s++)s>=t.length?t.push(n[s+2]):t[s]=n[s+2];for(let s=0;s<t.length;s++)if(s<o.length){if(o[s]<0)throw new Error("strides should be greater than or equal to 1")}else o.push(1);for(let s=0;s<t.length;s++)if(s<i.length){if(i[s]<0)throw new Error("dilations should be greater than or equal to 1")}else i.push(1);for(let s=0;s<t.length*2;s++)if(s<a.length){if(a[s]<0)throw new Error("pad should be greater than or equal to 1")}else a.push(0);for(let s=0;s<t.length;s++){if(t[s]<=0)throw new Error("kernel shapes need to be greater than 0");if(a[s]>=t[s]||a[s+t.length]>=t[s])throw new Error("pads should be smaller than kernel")}}static adjustPadsBasedOnAutoPad(e,n,t,o,i,a){if(a){if(i.length!==2*(e.length-2))throw new Error("length of pads should be twice the length of data dimensions");if(n.length!==e.length-2)throw new Error("length of strides should be the length of data dimensions");if(o.length!==e.length-2)throw new Error("length of kernel shapes should be the length of data dimensions");for(let s=0;s<e.length-2;s++)r.adjustPadAndReturnShape(e[s+2],n[s],t[s],o[s],i,s,s+e.length-2,a)}}static computePoolOutputShape(e,n,t,o,i,a,s){if(n.length<=0)throw new Error("input shape must be of size greater than 0");let u=[n[0],n[1]];return r.computeShapeHelper(e,n,u,t,o,i,a,s),u}static computeConvOutputShape(e,n,t,o,i,a,s){if(e.length<=0||n.length<=0)throw new Error("invalid input tensor dims or invalid filter tensor dims");let u=[e[0],n[0]];return r.computeShapeHelper(!1,e,u,t,o,i,a,s),u}static computeShapeHelper(e,n,t,o,i,a,s,u){if(e)for(let l=0;l<n.length-2;l++)t.push(1);else for(let l=0;l<n.length-2;l++)t.push(r.adjustPadAndReturnShape(n[l+2],o[l],i[l],a[l],s,l,l+n.length-2,u))}static adjustPadAndReturnShape(e,n,t,o,i,a,s,u){let l=t*(o-1)+1;if(u&&u!=="NOTSET")switch(u){case"VALID":return i[a]=0,i[s]=0,Math.floor((e-l)/n+1);case"SAME_LOWER":case"SAME_UPPER":if(t!==1)throw new Error("Dilation not supported for SAME_UPPER or SAME_LOWER");{let p=((e+n-1)/n-1)*n+o-e;return i[a]=Math.floor(u==="SAME_LOWER"?(p+1)/2:p/2),i[s]=p-i[a],Math.floor((e+p-o)/n+1)}default:throw new Error("Unsupported AutoPad type")}else return Math.floor((e+i[a]+i[s]-l)/n+1)}},Dr=-34028234663852886e22,kr=34028234663852886e22});function j$(r){switch(r){case"bool":case"int8":case"uint8":return 1;case"int16":case"uint16":return 2;case"int32":case"uint32":case"float32":return 4;case"float64":return 8;default:throw new Error(`cannot calculate sizeof() on type ${r}`)}}function sm(r){switch(r){case Se.onnx.TensorProto.DataType.UINT8:case Se.onnx.TensorProto.DataType.INT8:case Se.onnx.TensorProto.DataType.BOOL:return 1;case Se.onnx.TensorProto.DataType.UINT16:case Se.onnx.TensorProto.DataType.INT16:return 2;case Se.onnx.TensorProto.DataType.FLOAT:case Se.onnx.TensorProto.DataType.INT32:case Se.onnx.TensorProto.DataType.UINT32:return 4;case Se.onnx.TensorProto.DataType.INT64:case Se.onnx.TensorProto.DataType.DOUBLE:case Se.onnx.TensorProto.DataType.UINT64:return 8;default:throw new Error(`cannot calculate sizeof() on type ${Se.onnx.TensorProto.DataType[r]}`)}}function K$(r,e){return new(cm(e))(r)}function cm(r){switch(r){case"bool":case"uint8":return Uint8Array;case"int8":return Int8Array;case"int16":return Int16Array;case"uint16":return Uint16Array;case"int32":return Int32Array;case"uint32":return Uint32Array;case"int64":return BigInt64Array;case"float32":return Float32Array;case"float64":return Float64Array;default:throw new Error("unspecified error")}}function Il(r,e){if(e===Se.onnx.TensorProto.DataType.INT64||e===So.TensorDataType.INT64){if(r.greaterThanOrEqual(2147483648)||r.lessThan(-2147483648))throw new TypeError("int64 is not supported")}else if(e===Se.onnx.TensorProto.DataType.UINT32||e===So.TensorDataType.UINT32||e===Se.onnx.TensorProto.DataType.UINT64||e===So.TensorDataType.UINT64){if(r.greaterThanOrEqual(4294967296)||r.lessThan(0))throw new TypeError("uint64 is not supported")}else throw new TypeError(`not a LONG type: ${Se.onnx.TensorProto.DataType[e]}`);return r.toNumber()}function um(r,e,n){switch(e){case Se.onnx.TensorProto.DataType.BOOL:case Se.onnx.TensorProto.DataType.UINT8:return r.getUint8(n);case Se.onnx.TensorProto.DataType.INT8:return r.getInt8(n);case Se.onnx.TensorProto.DataType.UINT16:return r.getUint16(n,!0);case Se.onnx.TensorProto.DataType.INT16:return r.getInt16(n,!0);case Se.onnx.TensorProto.DataType.FLOAT:return r.getFloat32(n,!0);case Se.onnx.TensorProto.DataType.INT32:return r.getInt32(n,!0);case Se.onnx.TensorProto.DataType.UINT32:return r.getUint32(n,!0);case Se.onnx.TensorProto.DataType.INT64:return Il(cr.fromBits(r.getUint32(n,!0),r.getUint32(n+4,!0),!1),e);case Se.onnx.TensorProto.DataType.DOUBLE:return r.getFloat64(n,!0);case Se.onnx.TensorProto.DataType.UINT64:return Il(cr.fromBits(r.getUint32(n,!0),r.getUint32(n+4,!0),!0),e);default:throw new Error(`cannot read from DataView for type ${Se.onnx.TensorProto.DataType[e]}`)}}var lm,Se,it,Nr=L(()=>{"use strict";lm=ve(If());Fs();$o();Se=ve(Qr());Be();it=class r{constructor(e,n,t,o,i,a=lm.Guid.create()){this.dims=e;this.type=n;this.dataProvider=t;this.asyncDataProvider=o;this.cache=i;this.dataId=a;this.size=ae.validateDimsAndCalcSize(e);let s=this.size,u=t===void 0&&o===void 0&&i===void 0;if(i!==void 0&&i.length!==s)throw new RangeError("Input dims doesn't match data length.");if(n==="string"){if(i!==void 0&&(!Array.isArray(i)||!i.every(l=>typeof l=="string")))throw new TypeError("cache should be a string array");u&&(this.cache=new Array(s))}else{if(i!==void 0){let l=cm(n);if(!(i instanceof l))throw new TypeError(`cache should be type ${l.name}`)}if(u){let l=new ArrayBuffer(s*j$(n));this.cache=K$(l,n)}}}get data(){if(this.cache===void 0){let e=this.dataProvider(this.dataId);if(e.length!==this.size)throw new Error("Length of data provided by the Data Provider is inconsistent with the dims of this Tensor.");this.cache=e}return this.cache}get stringData(){if(this.type!=="string")throw new TypeError("data type is not string");return this.data}get integerData(){switch(this.type){case"uint8":case"int8":case"uint16":case"int16":case"int32":case"uint32":case"bool":return this.data;default:throw new TypeError("data type is not integer (uint8, int8, uint16, int16, int32, uint32, bool)")}}get floatData(){switch(this.type){case"float32":case"float64":return this.data;default:throw new TypeError("data type is not float (float32, float64)")}}get numberData(){if(this.type!=="string")return this.data;throw new TypeError("type cannot be non-number (string)")}get(e){return this.data[ae.indicesToOffset(e,this.strides)]}set(e,n){this.data[ae.indicesToOffset(e,this.strides)]=n}async getData(){return this.cache===void 0&&(this.cache=await this.asyncDataProvider(this.dataId)),this.cache}get strides(){return this._strides||(this._strides=ae.computeStrides(this.dims)),this._strides}static fromProto(e){if(!e)throw new Error("cannot construct Value from an empty tensor");let n=mt.tensorDataTypeFromProto(e.dataType),t=mt.tensorDimsFromProto(e.dims),o=new r(t,n);if(n==="string")e.stringData.forEach((i,a)=>{o.data[a]=Do(i)});else if(e.rawData&&typeof e.rawData.byteLength=="number"&&e.rawData.byteLength>0){let i=o.data,a=new DataView(e.rawData.buffer,e.rawData.byteOffset,e.rawData.byteLength),s=sm(e.dataType),u=e.rawData.byteLength/s;if(e.rawData.byteLength%s!==0)throw new Error("invalid buffer length");if(i.length!==u)throw new Error("buffer length mismatch");for(let l=0;l<u;l++){let d=um(a,e.dataType,l*s);i[l]=d}}else{let i;switch(e.dataType){case Se.onnx.TensorProto.DataType.FLOAT:i=e.floatData;break;case Se.onnx.TensorProto.DataType.INT32:case Se.onnx.TensorProto.DataType.INT16:case Se.onnx.TensorProto.DataType.UINT16:case Se.onnx.TensorProto.DataType.INT8:case Se.onnx.TensorProto.DataType.UINT8:case Se.onnx.TensorProto.DataType.BOOL:i=e.int32Data;break;case Se.onnx.TensorProto.DataType.INT64:i=e.int64Data;break;case Se.onnx.TensorProto.DataType.DOUBLE:i=e.doubleData;break;case Se.onnx.TensorProto.DataType.UINT32:case Se.onnx.TensorProto.DataType.UINT64:i=e.uint64Data;break;default:throw new Error("unspecific error")}if(i==null)throw new Error("failed to populate data from a tensorproto value");let a=o.data;if(a.length!==i.length)throw new Error("array length mismatch");for(let s=0;s<i.length;s++){let u=i[s];cr.isLong(u)?a[s]=Il(u,e.dataType):a[s]=u}}return o}static fromData(e,n,t){return new r(n,t,void 0,void 0,e)}static fromOrtTensor(e){if(!e)throw new Error("cannot construct Value from an empty tensor");let n=mt.tensorDimsFromORTFormat(e),t=mt.tensorDataTypeFromProto(e.dataType()),o=new r(n,t);if(t==="string")for(let i=0;i<e.stringDataLength();i++)o.data[i]=e.stringData(i);else if(e.rawDataArray()&&typeof e.rawDataLength()=="number"&&e.rawDataLength()>0){let i=o.data,a=new DataView(e.rawDataArray().buffer,e.rawDataArray().byteOffset,e.rawDataLength()),s=sm(e.dataType()),u=e.rawDataLength()/s;if(e.rawDataLength()%s!==0)throw new Error("invalid buffer length");if(i.length!==u)throw new Error("buffer length mismatch");for(let l=0;l<u;l++){let d=um(a,e.dataType(),l*s);i[l]=d}}return o}}});function le(r){return r===1?X$:Z$}function dm(r){let e=le(r);return`${e.version}
      precision highp float;
      ${e.attribute} vec3 position;
      ${e.attribute} vec2 textureCoord;

      ${e.varyingVertex} vec2 TexCoords;

      void main()
      {
          gl_Position = vec4(position, 1.0);
          TexCoords = textureCoord;
      }`}function pm(r){let e=le(r);return`${e.version}
    precision highp float;
    precision highp int;
    precision highp sampler2D;
    ${e.varyingFrag} vec2 TexCoords;
    ${e.outputDeclaration}
    const vec2 halfCR = vec2(0.5, 0.5);

    // Custom vector types to handle higher dimenalities.
    struct ivec5
    {
      int x;
      int y;
      int z;
      int w;
      int u;
    };

    struct ivec6
    {
      int x;
      int y;
      int z;
      int w;
      int u;
      int v;
    };

    int imod(int x, int y) {
      return x - y * (x / y);
    }

    `}function fm(r,e){let n=le(r);return`
  void main() {
    int indices[${e}];
    toVec(TexCoords, indices);
    vec4 result = vec4(process(indices));
    ${n.output} = result;
  }
  `}var X$,Z$,Qe=L(()=>{"use strict";X$={version:"",attribute:"attribute",varyingVertex:"varying",varyingFrag:"varying",texture2D:"texture2D",output:"gl_FragColor",outputDeclaration:""},Z$={version:"#version 300 es",attribute:"in",varyingVertex:"out",varyingFrag:"in",texture2D:"texture",output:"outputColor",outputDeclaration:"out vec4 outputColor;"}});var Pe=L(()=>{"use strict"});async function Sl(r,e=t=>0,n){return new Promise((t,o)=>{let i=0,a=()=>{if(r()){t();return}i++;let s=e(i);if(n!=null&&i>=n){o();return}setTimeout(a,s)};a()})}function Ui(r){return eo(typeof r<"u"&&r.length!==0,()=>"empty string found for sampler name"),"get"+r.charAt(0).toUpperCase()+r.slice(1)}function hm(r){return eo(typeof r<"u"&&r.length!==0,()=>"empty string found for sampler name"),"get"+r.charAt(0).toUpperCase()+r.slice(1)+"AtOutCoords"}function to(r,e){let n=JSON.parse(JSON.stringify(r));return n=e,n}function no(r,e){return e.map(n=>r[n]).join(", ")}function yt(r){if(r<=1)return"int";if(r===2)return"ivec2";if(r===3)return"ivec3";if(r===4)return"ivec4";if(r===5)return"ivec5";if(r===6)return"ivec6";throw Error(`GPU for rank ${r} is not yet supported`)}function Xt(r=6){return["x","y","z","w","u","v"].slice(0,r)}var zn=L(()=>{"use strict";Be()});function J$(r,e){return Xt(e).map(n=>`${r}.${n}`)}function ro(r,e){return e===1?[r]:J$(r,e)}function Mn(){return`
    float getChannel(vec4 frag, int dim) {
      int modCoord = imod(dim, 2);
      return modCoord == 0 ? frag.r : frag.g;
    }

    float getChannel(vec4 frag, vec2 innerDims) {
      vec2 modCoord = mod(innerDims, 2.);
      return modCoord.x == 0. ?
        (modCoord.y == 0. ? frag.r : frag.g) :
        (modCoord.y == 0. ? frag.b : frag.a);
    }
  `}var Lr=L(()=>{"use strict";zn()});function Q$(r,e,n){if(r===0)return"false";if(r===1)return`rc > ${e[0]}`;let t="";for(let o=r-2;o<r;o++)t+=`${n[o]} >= ${e[o-r+2]}`,o<r-1&&(t+="||");return t}function eA(r,e){let n=r.length;if(n===0)return"getA(), 0, 0, 0";if(n===1)return`getA(rc),
            rc + 1 >= ${r[0]} ? 0. : getA(rc + 1),
            0, 0`;let t="r, c",o="r, cp1",i="rp1, c",a="rp1, cp1",s="";if(n>2)for(let u=0;u<n-2;++u)s=s+`${e[u]},`;return`getA(${s}${t}),
          rEdge ? 0. : getA(${s}${i}),
          cEdge ? 0. : getA(${s}${o}),
          rEdge || cEdge ? 0. : getA(${s}${a})`}function tA(r,e,n,t){return r===0||r===1?"":`
    int r = ${e[r-2]};
    int c = ${e[r-1]};
    int rp1 = ${e[r-2]} + 1;
    int cp1 = ${e[r-1]} + 1;
    bool rEdge = rp1 >= ${t};
    bool cEdge = cp1 >= ${n};
    `}var mm,Y$,gm,bm=L(()=>{"use strict";Qe();Pe();zn();Lr();mm={name:"pack",inputNames:["A"],inputTypes:[1]},Y$=(r,e)=>{let n=le(r.session.backend.glContext.version),t=e.dims,o=t.length,i=e.dims.length,a=yt(i),s=ro("rc",i),u=tA(i,s,t[t.length-2],t[t.length-1]),l;o===0?l=[1,1]:o===1?l=[t[0],1]:l=[t[i-1],t[i-2]];let d=Q$(i,l,s),p=eA(t,s),h=`
        void main() {
          ${a} rc = getOutputCoords();

          if(${d}) {
            ${n.output} = vec4(0);
          } else {
            ${u}

            ${n.output} = vec4(${p});
          }
        }
      `;return{...mm,hasMain:!0,output:{dims:e.dims,type:e.type,textureType:2},shaderSource:h}},gm=(r,e)=>({...mm,get:()=>Y$(r,e)})});function $l(r){if(r.length===0)return[1,1,1];let e=1;for(let n=0;n<r.length-2;++n)e*=r[n];return[e,r.length>1?r[r.length-2]:1,r[r.length-1]]}function _m(r,e){let n=!1;return r.length===0||e.length===0?n=!0:r.length<2||e.length<2?n=r[r.length-1]===e[e.length-1]:n=r[r.length-1]===e[e.length-1]&&r[r.length-2]===e[e.length-2],n}function oA(r){let e=ae.computeStrides(r),n=["b","r","c"],t="index";return`
    ivec3 inputCoordsFromReshapedOutCoords(int index) {
      ${e.map((i,a)=>{let s=`int ${n[a]} = ${t} / ${i}`,u=a===e.length-1?`int ${n[a+1]} = ${t} - ${n[a]} * ${i}`:`index -= ${n[a]} * ${i}`;return`${s}; ${u};`}).join("")}
      return ivec3(b, r, c);
    }
  `}function iA(r){let e=ae.computeStrides(r);return`
  int getFlattenedIndex(ivec3 coords) {
    // reverse y, z order
    return coords.x * ${e[0]} + coords.z * ${e[1]} + coords.y;
  }
`}var nA,rA,ym,wm=L(()=>{"use strict";Be();Qe();Pe();Lr();nA=r=>({name:"Reshape (packed)",inputTypes:[2],inputNames:["A"],cacheHint:`${r}`}),rA=(r,e,n,t)=>{let o=e.dims,i=t,a="";for(let l=0;l<4;l++){let d="";switch(l){case 0:d="outputCoords = rc;";break;case 1:d="outputCoords = ivec3(rc.x, rc.y+1, rc.z);";break;case 2:d="outputCoords = ivec3(rc.x, rc.y, rc.z+1);";break;case 3:d="outputCoords = ivec3(rc.x, rc.y+1, rc.z+1);";break;default:throw new Error}a+=`
        ${d}
        ${l>0?"if(outputCoords.y < rows && outputCoords.z < cols){":""}
          int flattenedIndex = getFlattenedIndex(outputCoords);

          ivec3 inputRC = inputCoordsFromReshapedOutCoords(flattenedIndex);
          vec2 innerDims = vec2(float(inputRC.y),float(inputRC.z));

          result[${l}] = getChannel(getA(inputRC.x, inputRC.y, inputRC.z), innerDims);

        ${l>0?"}":""}
      `}let s=le(r.session.backend.glContext.version),u=`
      ${oA(o)}
      ${iA(i)}
      ${Mn()}

      void main() {
        ivec3 rc = getOutputCoords();

        vec4 result = vec4(0.0);

        ivec3 outputCoords;
        int rows = ${i[2]};
        int cols = ${i[1]};

        ${a}
        ${s.output} = result;
      }
    `;return{...n,output:{dims:i,type:e.type,textureType:2},shaderSource:u,hasMain:!0}},ym=(r,e,n)=>{let t=nA(n);return{...t,get:()=>rA(r,e,t,n)}}});var Al,vm=L(()=>{"use strict";Qe();Pe();Al=(r,e)=>{let n=e.shape,t=le(r.session.backend.glContext.version),o=`
    const float FLOAT_MAX = 1.70141184e38;
    const float FLOAT_MIN = 1.17549435e-38;

    bool isNaN(float val) {
      return (val < 1.0 || 0.0 < val || val == 0.0) ? false : true;
    }

    highp vec4 encodeAsUint8(highp float v) {
      if (isNaN(v)) {
        return vec4(255, 255, 255, 255);
      }

      highp float av = abs(v);

      if(av < FLOAT_MIN) {
        return vec4(0.0, 0.0, 0.0, 0.0);
      } else if(v > FLOAT_MAX) {
        return vec4(0.0, 0.0, 128.0, 127.0) / 255.0;
      } else if(v < -FLOAT_MAX) {
        return vec4(0.0, 0.0,  128.0, 255.0) / 255.0;
      }

      highp vec4 c = vec4(0,0,0,0);

      highp float e = floor(log2(av));
      highp float m = exp2(fract(log2(av))) - 1.0;

      c[2] = floor(128.0 * m);
      m -= c[2] / 128.0;
      c[1] = floor(32768.0 * m);
      m -= c[1] / 32768.0;
      c[0] = floor(8388608.0 * m);

      highp float ebias = e + 127.0;
      c[3] = floor(ebias / 2.0);
      ebias -= c[3] * 2.0;
      c[2] += floor(ebias) * 128.0;

      c[3] += 128.0 * step(0.0, -v);

      return c / 255.0;
    }

    void main() {
      float value = ${t.texture2D}(X,TexCoords).r;
      ${t.output} = encodeAsUint8(value);
    }`,i={name:"Uint8Encode",inputTypes:[0],inputNames:["X"],output:{dims:n,type:e.tensor.type,textureType:3},shaderSource:o,hasMain:!0};return r.executeProgram(i,[e.tensor])}});function sA(r,e){if(r===1)return"rc";let n="";for(let t=0;t<r;t++)n+=e[t],t<r-1&&(n+=",");return n}var xm,aA,Tm,Im=L(()=>{"use strict";Qe();Pe();zn();Lr();xm={name:"unpack",inputNames:["A"],inputTypes:[2]},aA=(r,e)=>{let n=e.dims.length,t=ro("rc",n),o=t.slice(-2),i=yt(n),a=Mn(),u=e.dims.length===0?"":sA(n,t),l=n<=1?"rc":`vec2(${o.join(",")})`,d=le(r.session.backend.glContext.version),p=`
    ${a}
    void main() {
      ${i} rc = getOutputCoords();

       // Sample the texture with the coords to get the rgba channel value.
       vec4 packedInput = getA(${u});

       ${d.output} = vec4(getChannel(packedInput, ${l}), 0, 0, 0);
     }
   `;return{...xm,hasMain:!0,output:{dims:e.dims,type:e.type,textureType:0},shaderSource:p}},Tm=(r,e)=>({...xm,get:()=>aA(r,e)})});var Fi,ko,Wi,No=L(()=>{"use strict";Dt();Fi=class{constructor(e,n=1){if(n===1)this.internalFormat=e.R32F,this.format=e.RED,this.textureType=e.FLOAT,this.channelSize=n;else if(n===4)this.internalFormat=e.RGBA32F,this.format=e.RGBA,this.textureType=e.FLOAT,this.channelSize=n;else throw new Error(`Invalid number of channels: ${n}`)}encode(e,n){let t,o;return e.constructor!==Float32Array&&(Ge.warning("Encoder","data was not of type Float32; creating new Float32Array"),o=new Float32Array(e)),n*this.channelSize>e.length?(Ge.warning("Encoder","Source data too small. Allocating larger array"),o=e,t=this.allocate(n*this.channelSize),o.forEach((i,a)=>t[a]=i)):(o=e,t=o),t}allocate(e){return new Float32Array(e*4)}decode(e,n){return this.channelSize===1?e.filter((o,i)=>i%4===0).subarray(0,n):e.subarray(0,n)}},ko=class{constructor(e,n=1,t){if(n!==1&&n!==4)throw new Error(`Invalid number of channels: ${n}`);this.internalFormat=e.RGBA,this.format=e.RGBA,this.channelSize=n,this.textureType=t||e.FLOAT}encode(e,n){let t=e;return this.channelSize===1&&(Ge.verbose("Encoder","Exploding into a larger array"),t=this.allocate(n),e.forEach((o,i)=>t[i*4]=o)),t}allocate(e){return new Float32Array(e*4)}decode(e,n){return this.channelSize===1?e.filter((o,i)=>i%4===0).subarray(0,n):e.subarray(0,n)}},Wi=class{constructor(e,n=1){this.channelSize=4;if(n===1)this.internalFormat=e.ALPHA,this.format=e.ALPHA,this.textureType=e.UNSIGNED_BYTE,this.channelSize=n;else if(n===4)this.internalFormat=e.RGBA,this.format=e.RGBA,this.textureType=e.UNSIGNED_BYTE,this.channelSize=n;else throw new Error(`Invalid number of channels: ${n}`)}encode(e,n){return new Uint8Array(e.buffer,e.byteOffset,e.byteLength)}allocate(e){return new Uint8Array(e*this.channelSize)}decode(e,n){if(e instanceof Uint8Array)return e.subarray(0,n);throw new Error(`Invalid array type: ${e.constructor}`)}}});var Lo,Sm,Ol,$m=L(()=>{"use strict";Be();Pe();Lo=(r,e,n)=>{let t=n===0||n===1?1:4,o=n===2,i=n===1||n===2,a=n===4?e.length-1:void 0,s=n===4?e.map((u,l)=>l===e.length-1?u*4:u):void 0;return Ol(r,e,t,s,{isPacked:o,reverseWH:i,breakAxis:a})},Sm=(r,e,n)=>{let t=Lo(r,e,n);return[t.width,t.height]},Ol=(r,e,n=1,t,o)=>{let i=!!(o&&o.isPacked),[a,s]=r.computeTextureWH(i&&t||e,o),u=e.length,l=e.slice(0);if(u===0&&(l=[1]),n===1)t=e;else if(i){if(n!==4)throw new Error("a packed texture must be 4-channel");t=e,u>0&&(l[u-1]=Math.ceil(l[u-1]/2)),u>1&&(l[u-2]=Math.ceil(l[u-2]/2))}else if(!t)throw new Error("Unpacked shape is needed when using channels > 1");return{width:a,height:s,channels:n,isPacked:i,shape:l,strides:ae.computeStrides(l),unpackedShape:t,reversedWH:o&&o.reverseWH}}});var lA,Hi,Om=L(()=>{"use strict";Dt();Nr();Be();bm();wm();vm();Im();No();$m();Pe();lA=(r,e)=>{let n=e.map(o=>`${o.unpackedShape.join(",")};${o.width}x${o.height}`).join("_"),t=r.name;return r.cacheHint&&(t+="["+r.cacheHint+"]"),t+=":"+n,t},Hi=class{constructor(e){this.session=e;this.packedTextureDataCache=new Map,this.unpackedTextureDataCache=new Map}calculateTextureWidthAndHeight(e,n){return Sm(this.session.layoutStrategy,e,n)}executeProgram(e,n){if(n.length<e.inputNames.length)throw new Error(`Input size mustn't be less than ${e.inputNames.length}.`);if(e.inputNames.length!==e.inputTypes.length)throw new Error("input names size does not match input types");let t=[];for(let l=0;l<e.inputNames.length;++l)t[l]=this.getOrCreateTextureData(n[l],e.inputTypes[l]);let o=lA(e,t),i=this.session.programManager.getArtifact(o),a=i?i.programInfo:typeof e.get=="function"?e.get():e,s=Lo(this.session.layoutStrategy,a.output.dims,a.output.textureType),u=this.createTextureData(s,a.output.type);return i||(i=this.session.programManager.build(a,t,u),this.session.programManager.setArtifact(o,i)),this.runProgram(i,t,u),u}run(e,n){return this.executeProgram(e,n).tensor}runProgram(e,n,t){for(let o=0;o<n.length;++o)if(!!n[o].isPacked!=(e.programInfo.inputTypes[o]===2))throw new Error(`input[${o}] property packed inconsistent`);if(!!t.isPacked!=(e.programInfo.output.textureType===2))throw new Error("output property packed inconsistent");this.session.programManager.run(e,n,t)}getOrCreateTextureData(e,n){let t=this.getTextureData(e.dataId,n===2);if(!t&&(t=this.getTextureData(e.dataId,n!==2),t))return n===2?this.pack(t):this.unpack(t);if(!t){let o=Lo(this.session.layoutStrategy,e.dims,n);if(n===4){let s=e.dims;if(s.length===4){let u=[s[0],Math.ceil(s[1]*s[2]*s[3]/4)],l=Lo(this.session.layoutStrategy,u,n),d=e.numberData;if(s[1]*s[2]*s[3]%4!==0){let p=s[0],h=s[1]*s[2]*s[3],g=Math.ceil(h*1/4)*4,b=p*g;d=new Float32Array(b);for(let _=0;_<p;++_){let S=_*h,v=_*g+_%1*h;d.set(e.numberData.subarray(S,S+h),v)}}return this.createTextureData(l,e.type,d,e,1)}}if(n===2){let i=Ol(this.session.layoutStrategy,e.dims,1,[],{reverseWH:!0}),a=this.createTextureData(i,e.type,e.numberData,e,1);t=this.pack(a)}else t=this.createTextureData(o,e.type,e.numberData,e,1)}return t}createTextureDataFromLayoutBindTensor(e,n,t,o){return this.createTextureData(e,n,t,o,1)}createTextureData(e,n,t,o,i){Ge.verbose("InferenceHandler",`Creating TextureData: layout:[${JSON.stringify(e)}]`);let a=this.session.textureManager.createTextureFromLayout(n,e,t,i);return this.createTextureDataFromTexture(e,n,a,o)}reshapeUnpacked(e,n){let t=this.getOrCreateTextureData(e,0),o={channels:t.channels,height:t.height,width:t.width,shape:n.length!==0?n:[1],strides:ae.computeStrides(n),unpackedShape:n};return this.createTextureDataFromTexture(o,e.type,t.texture).tensor}reshapePacked(e,n){let t=this.getOrCreateTextureData(e,2);if(_m(e.dims,n)){let l={channels:t.channels,height:t.height,width:t.width,shape:n.length!==0?n:[1],strides:ae.computeStrides(n),unpackedShape:n,isPacked:!0};return this.createTextureDataFromTexture(l,e.type,t.texture).tensor}let o=$l(e.dims),i=$l(n),a=this.reshapePacked(e,o),s=this.run(ym(this,a,i),[a]);return this.reshapePacked(s,n)}cast(e,n){let t=this.getOrCreateTextureData(e,0);return this.createTextureDataFromTexture(t,n,t.texture).tensor}createTextureDataFromTexture(e,n,t,o,i){let a={...e,tensor:o||new it(e.unpackedShape,n,s=>this.readTexture(a),async s=>this.readTextureAsync(a),void 0,i),texture:t};return this.setTextureData(a.tensor.dataId,a,e.isPacked),a}getTextureData(e,n=!1){return this.session.isInitializer(e)?this.session.getTextureData(e,n):n?this.packedTextureDataCache.get(e):this.unpackedTextureDataCache.get(e)}setTextureData(e,n,t=!1){this.session.isInitializer(e)?this.session.setTextureData(e,n,t):(t?this.packedTextureDataCache:this.unpackedTextureDataCache).set(e,n)}isTextureLayoutCached(e,n=!1){return!!this.getTextureData(e.dataId,n)}dispose(){this.session.textureManager.clearActiveTextures(),this.packedTextureDataCache.forEach(e=>this.session.textureManager.releaseTexture(e)),this.packedTextureDataCache=new Map,this.unpackedTextureDataCache.forEach(e=>this.session.textureManager.releaseTexture(e)),this.unpackedTextureDataCache=new Map}readTexture(e){return e.isPacked?this.readTexture(this.unpack(e)):this.session.backend.glContext.isFloat32DownloadSupported?this.session.textureManager.readTexture(e,e.tensor.type,e.channels):this.session.textureManager.readUint8TextureAsFloat(Al(this,e))}async readTextureAsync(e){return e.isPacked?this.readTextureAsync(this.unpack(e)):this.session.backend.glContext.isFloat32DownloadSupported?this.session.textureManager.readTextureAsync(e,e.tensor.type,e.channels):this.session.textureManager.readUint8TextureAsFloat(Al(this,e))}pack(e){return this.executeProgram(gm(this,e.tensor),[e.tensor])}unpack(e){return this.executeProgram(Tm(this,e.tensor),[e.tensor])}}});var Pl,xe,pt=L(()=>{"use strict";Pl=class{constructor(e){Object.assign(this,e)}get cacheKey(){return this.key||(this.key=Object.getOwnPropertyNames(this).sort().map(e=>`${this[e]}`).join(";")),this.key}},xe=r=>new Pl(r)});var Pm,Em,Cm,cA,dA,Dm=L(()=>{"use strict";pt();Qe();Pe();Pm={name:"BatchNormalization",inputNames:["A","Scale","B","Mean","Variance"],inputTypes:[0,0,0,0,0]},Em=(r,e,n)=>(dA(e),[r.run({...Pm,cacheHint:n.cacheKey,get:()=>cA(r,e,n)},e)]),Cm=r=>{let e=r.attributes.getFloat("epsilon",1e-5),n=r.attributes.getFloat("momentum",.9),t=r.attributes.getInt("spatial",1);return xe({epsilon:e,momentum:n,spatial:t})},cA=(r,e,n)=>{let t=le(r.session.backend.glContext.version),o=e[0].dims.length,[i,a]=r.calculateTextureWidthAndHeight(e[1].dims,0),s=`
  float process(int[${o}] indices) {
    vec2 position = offsetToCoords(indices[1], ${i}, ${a});
    float scale = getColorAsFloat(${t.texture2D}(Scale, position));
    float mean = getColorAsFloat(${t.texture2D}(Mean, position));
    float variance = getColorAsFloat(${t.texture2D}(Variance, position));
    float b = getColorAsFloat(${t.texture2D}(B, position));

    return scale * ( (_A(indices) - mean) / sqrt(variance + float(${n.epsilon})) ) + b;
  }`;return{...Pm,output:{dims:e[0].dims,type:e[0].type,textureType:0},shaderSource:s}},dA=r=>{if(!r||r.length!==5)throw new Error("BatchNormalization requires 5 inputs.");let e=r[0],n=r[1],t=r[2],o=r[3],i=r[4];if(e.dims.length<3||n.dims.length!==1||t.dims.length!==1||o.dims.length!==1||i.dims.length!==1)throw new Error("invalid input shape.");if(n.dims[0]!==e.dims[1]||t.dims[0]!==e.dims[1]||o.dims[0]!==e.dims[1]||i.dims[0]!==e.dims[1])throw new Error("invalid input shape.");if(e.type!=="float32"&&e.type!=="float64"||n.type!=="float32"&&n.type!=="float64"||t.type!=="float32"&&t.type!=="float64"||o.type!=="float32"&&o.type!=="float64"||i.type!=="float32"&&i.type!=="float64")throw new Error("invalid input tensor types.")}});var qi,Vt,ee,Ro,ji,Yn=L(()=>{"use strict";qi=class{constructor(e,n,t,o){this.glContext=e;this.programInfo=n;this.inputTextureLayouts=t;this.outputTextureLayout=o}},Vt=class{constructor(e){this.context=e}},ee=class{constructor(e,n){this.routineBody=e;this.dependencies=n}},Ro=class{constructor(e,n,t){this.name=e;t?this.dependencies=t:this.dependencies=[],n&&(this.routineBody=n)}addDependency(e){e&&this.dependencies.push(e)}},ji=class{static returnOrderedNodes(e){if(!e||e.length===0)return[];if(e.length===1)return e;let n=new Set,t=new Set,o=new Array;return this.createOrderedNodes(e,n,t,o),o}static createOrderedNodes(e,n,t,o){for(let i=0;i<e.length;++i)this.dfsTraverse(e[i],n,t,o)}static dfsTraverse(e,n,t,o){if(!e||t.has(e.name))return;if(n.has(e.name))throw new Error("Cyclic dependency detected. Can't topologically sort routines needed for shader.");n.add(e.name);let i=e.dependencies;if(i&&i.length>0)for(let a=0;a<i.length;++a)this.dfsTraverse(i[a],n,t,o);o.push(e),t.add(e.name),n.delete(e.name)}}});function fA(){let r="add_";return{body:`
  float ${r}(float a, float b) {
    return a + b;
  }
  vec4 ${r}(vec4 v1, vec4 v2) {
    return v1 + v2;
  }
  `,name:r,type:0}}function hA(){let r="div_";return{body:`
  float ${r}(float a, float b) {
    return a / b;
  }
  vec4 ${r}(vec4 v1, vec4 v2) {
    return v1 / v2;
  }
  `,name:r,type:0}}function mA(){let r="mul_";return{body:`
  float ${r}(float a, float b) {
    return a * b;
  }
  vec4 ${r}(vec4 v1, vec4 v2) {
    return v1 * v2;
  }
  `,name:r,type:0}}function gA(){let r="sub_";return{body:`
  float ${r}(float a, float b) {
    return a - b;
  }
  vec4 ${r}(vec4 v1, vec4 v2) {
    return v1 - v2;
  }
  `,name:r,type:0}}function bA(){let r="equal_";return{body:`
  float ${r}(float a, float b) {
    return float(a == b);
  }
  vec4 ${r}(vec4 v1, vec4 v2) {
    return vec4(equal(v1, v2));
  }
  `,name:r,type:0}}function yA(){let r="greater_";return{body:`
  float ${r}(float a, float b) {
    return float(a > b);
  }
  vec4 ${r}(vec4 v1, vec4 v2) {
    return vec4( v1.r > v2.r ,
      v1.g > v2.g,
      v1.b > v2.b,
      v1.a > v2.a );
  }
  `,name:r,type:0}}function _A(){let r="less_";return{body:`
  float ${r}(float a, float b) {
    return float(a < b);
  }
  vec4 ${r}(vec4 v1, vec4 v2) {
    return vec4( v1.r < v2.r ,
                v1.g < v2.g,
                v1.b < v2.b,
                v1.a < v2.a );
  }
  `,name:r,type:0}}function wA(){let r="and_";return{body:`
  float ${r}(float a, float b) {
    return float( bool(a) && bool(b) );
  }
  vec4 ${r}(vec4 v1, vec4 v2) {
    bvec4 b1 = bvec4(v1);
    bvec4 b2 = bvec4(v2);
    return vec4( b1.r && b2.r ,
                b1.g && b2.g,
                b1.b && b2.b,
                b1.a && b2.a );
  }
  `,name:r,type:0}}function vA(){return{body:`
  float or_(float a, float b) {
    return float( bool(a) || bool(b) );
  }
  vec4 or_(vec4 v1, vec4 v2) {
    bvec4 b1 = bvec4(v1);
    bvec4 b2 = bvec4(v2);
    return vec4( b1.r || b2.r ,
                b1.g || b2.g,
                b1.b || b2.b,
                b1.a || b2.a );
  }
  `,name:"or_",type:0}}function xA(){let r="xor_";return{body:`
  float ${r}(float a, float b) {
    return float( bool(a) ^^ bool(b) );
  }
  vec4 ${r}(vec4 v1, vec4 v2) {
    bvec4 b1 = bvec4(v1);
    bvec4 b2 = bvec4(v2);
    return vec4( b1.r ^^ b2.r ,
                b1.g ^^ b2.g,
                b1.b ^^ b2.b,
                b1.a ^^ b2.a );
  }
  `,name:r,type:0}}function TA(){return SA("pow")}function IA(){let r="prelu_";return{body:`
  float ${r}(float a, float b) {
    return a < 0.0 ? a * b: a;
  }
  vec4 ${r}(vec4 v1, vec4 v2) {
    return vec4(
      v1.r < 0.0 ? v1.r * v2.r: v1.r,
      v1.g < 0.0 ? v1.g * v2.g: v1.g,
      v1.b < 0.0 ? v1.b * v2.b: v1.b,
      v1.a < 0.0 ? v1.a * v2.a: v1.a
      );
  }
  `,name:r,type:0}}function SA(r){let e=`${r}_`;return{body:`
  float ${e}(float a, float b) {
    return ${r}(a, b);
  }
  vec4 ${e}(vec4 v1, vec4 v2) {
    return ${r}(v1, v2);
  }
  `,name:e,type:0}}var Gt,$A,km,Nm,Lm,Rm,zm,Mm,Bm,Vm,Gm,Um,Fm,Wm,Hm=L(()=>{"use strict";Be();Yn();Qe();Pe();Gt=(r,e,n,t=e[0].type,o)=>{let i=r.session.pack?2:0;return{name:n.name,inputNames:["A","B"],inputTypes:[i,i],cacheHint:o,get:()=>$A(r,e,n,t)}},$A=(r,e,n,t=e[0].type)=>{let o=r.session.pack?2:0,i=!ae.areEqual(e[0].dims,e[1].dims),a=e[0].dims,s=r.session.pack;if(i){let d=bt.calcShape(e[0].dims,e[1].dims,!1);if(!d)throw new Error("Can't perform binary op on the given tensors");a=d;let p=a.length,h=e[0].dims.length!==0?e[0].dims.length:1,g=e[1].dims.length!==0?e[1].dims.length:1,b=e[0].dims.length!==0?"bcastIndices_A(indices, aindices);":"aindices[0] = 0;",_=e[1].dims.length!==0?"bcastIndices_B(indices, bindices);":"bindices[0] = 0;",S=le(r.session.backend.glContext.version),v=s?`
      ${n.body}
      void main() {
        vec4 a = getAAtOutCoords();
        vec4 b = getBAtOutCoords();
        vec4 result = ${n.name}(a, b);
        ${S.output} = result;
      }`:`
      ${n.body}
      float process(int indices[${p}]) {
        int aindices[${h}];
        int bindices[${g}];
        ${b}
        ${_}
        return ${n.name}(_A(aindices), _B(bindices));
      }`;return{name:n.name,inputNames:["A","B"],inputTypes:[o,o],output:{dims:a,type:t,textureType:o},shaderSource:v,hasMain:s}}let u=le(r.session.backend.glContext.version),l=`
    ${n.body}
    void main() {
      vec4 v1 = ${u.texture2D}(A, TexCoords);
      vec4 v2 = ${u.texture2D}(B, TexCoords);
      vec4 result = ${n.name}(v1, v2);
      ${u.output} = result;
    }
    `;return{name:n.name,inputNames:["A","B"],inputTypes:[o,o],output:{dims:e[0].dims,type:t,textureType:o},shaderSource:l,hasMain:!0}},km=(r,e)=>[r.run(Gt(r,e,fA()),e)],Nm=(r,e)=>[r.run(Gt(r,e,wA(),"bool"),e)],Lm=(r,e)=>[r.run(Gt(r,e,hA()),e)],Rm=(r,e)=>[r.run(Gt(r,e,bA(),"bool"),e)],zm=(r,e)=>[r.run(Gt(r,e,yA(),"bool"),e)],Mm=(r,e)=>[r.run(Gt(r,e,_A(),"bool"),e)],Bm=(r,e)=>[r.run(Gt(r,e,mA()),e)],Vm=(r,e)=>[r.run(Gt(r,e,vA(),"bool"),e)],Gm=(r,e)=>[r.run(Gt(r,e,TA()),e)],Um=(r,e)=>[r.run(Gt(r,e,IA()),e)],Fm=(r,e)=>[r.run(Gt(r,e,gA()),e)],Wm=(r,e)=>[r.run(Gt(r,e,xA(),"bool"),e)]});var qm,jm,OA,Km=L(()=>{"use strict";Be();qm=(r,e,n)=>(OA(e),[r.cast(e[0],n)]),jm=r=>mt.tensorDataTypeFromProto(r.attributes.getInt("to")),OA=r=>{if(!r||r.length!==1)throw new Error("Cast requires 1 input.");if(r[0].type==="string")throw new Error("Invalid input type.")}});var PA,EA,Xm,Ki,Zm=L(()=>{"use strict";Qe();Pe();zn();Lr();PA=(r,e)=>({name:"Concat (packed)",inputNames:Array.from({length:r},(n,t)=>`X${t}`),inputTypes:Array(r).fill(2),cacheHint:e}),EA=(r,e,n,t)=>{let o=n[0].dims.slice();if(t>=o.length||t<-1*o.length)throw new Error("axis specified for concat doesn't match input dimensionality");t<0&&(t=o.length+t);let i=o.slice(0);for(let E=1;E<n.length;E++){let D=n[E].dims.slice();for(let B=0;B<o.length;B++)if(B===t)i[t]+=D[B];else if(o[B]!==D[B])throw new Error("non concat dimensions must match")}let a=i.length,s=ro("coords",a),u=yt(a),l=Mn(),d=n.map(E=>E.dims),p=Xt(a),h=new Array(d.length-1);h[0]=d[0][t];for(let E=1;E<h.length;E++)h[E]=h[E-1]+d[E][t];let g=p[t],b=p.slice(-2),_=p.join(),S=`if (${g} < ${h[0]}) {
        return getChannel(
            getX0(${_}), vec2(${b.join()}));
        }`;for(let E=1;E<h.length;E++){let D=h[E-1];S+=`
            if (${g} < ${h[E]}  && ${g} >= ${h[E-1]}) {
              return getChannel(
                getX${E}(${Ki(p,g,D)}),
                vec2(${Ki(b,g,D)}));
            }`}let v=h.length,x=h[h.length-1];S+=`
            return getChannel(
              getX${v}(${Ki(p,g,x)}),
              vec2(${Ki(b,g,x)}));`;let $=le(r.session.backend.glContext.version),O=`
          ${l}
          float getValue(${p.map(E=>"int "+E)}) {
            ${S}
          }

          void main() {
            ${u} coords = getOutputCoords();
            int lastDim = coords.${p[a-1]};
            coords.${p[a-1]} = coords.${p[a-2]};
            coords.${p[a-2]} = lastDim;

            vec4 result = vec4(getValue(${s}), 0., 0., 0.);

            ${s[a-1]} = ${s[a-1]} + 1;
            if (${s[a-1]} < ${i[a-1]}) {
              result.g = getValue(${s});
            }

            ${s[a-2]} = ${s[a-2]} + 1;
            if (${s[a-2]} < ${i[a-2]}) {
              result.a = getValue(${s});
            }

            ${s[a-1]} = ${s[a-1]} - 1;
            if (${s[a-2]} < ${i[a-2]} &&
                ${s[a-1]} < ${i[a-1]}) {
              result.b = getValue(${s});
            }
            ${$.output} = result;
          }
        `;return{...e,output:{dims:i,type:n[0].type,textureType:2},shaderSource:O,hasMain:!0}},Xm=(r,e,n)=>{let t=PA(e.length,n.cacheKey);return{...t,get:()=>EA(r,t,e,n.axis)}},Ki=(r,e,n)=>{let t=r.indexOf(e);return r.map((i,a)=>a===t?`${i} - ${n}`:i).join()}});var Jm,CA,DA,kA,Ym,NA,LA,RA,Qm,zA,eg=L(()=>{"use strict";pt();Pe();Zm();Jm=(r,e,n)=>(zA(e),r.session.pack&&e[0].dims.length>1?[r.run(Xm(r,e,n),e)]:[r.run(kA(r,e,n),e)]),CA=(r,e)=>({name:"Concat",inputNames:Array.from({length:r},(n,t)=>`X${t}`),inputTypes:Array(r).fill(0),cacheHint:e}),DA=(r,e,n,t)=>{let o=n[0].dims.slice();if(t>=o.length||t<-1*o.length)throw new Error("axis specified for concat doesn't match input dimensionality");t<0&&(t=o.length+t);let i=o.slice(0);for(let g=1;g<n.length;g++){let b=n[g].dims.slice();for(let _=0;_<o.length;_++)if(_===t)i[t]+=b[_];else if(o[_]!==b[_])throw new Error("non concat dimensions must match")}let a=i.length,s=new Array(n.length),u=0;for(let g=0;g<s.length;++g)u+=n[g].dims[t],s[g]=u;let l="";n.length<5?l=Ym(s):l=NA(s);let d=LA(n.length,a),p=RA(s),h=`
        ${d}
        ${p}
        ${l}
        float process(int indices[${a}]) {
          int textureIndex = getTextureWhereDataResides (indices[${t}]);

          if(textureIndex != 0) {
            indices[${t}] = indices[${t}] - int(getSizeInConcatAxisValueFromIndex(textureIndex-int(1)));
          }

          return fetchDataFromCorrectTexture(textureIndex, indices);
        }`;return{...e,output:{dims:i,type:n[0].type,textureType:0},shaderSource:h}},kA=(r,e,n)=>{let t=CA(e.length,n.cacheKey);return{...t,get:()=>DA(r,t,e,n.axis)}},Ym=r=>`int getTextureWhereDataResides(int index) {
      ${r.map((n,t)=>`if(index<${n}) {return ${t};}
`).join("")}
    }`,NA=r=>Ym(r),LA=(r,e)=>{let n=[`float fetchDataFromCorrectTexture(int textureIndex, int indices[${e}]) {`];for(let t=0;t<r;++t)t===0?n.push(`	if (textureIndex == ${t}) { return _X${t}(indices); }`):t===r-1?n.push(`	else { return _X${t}(indices); }`):n.push(`	else if (textureIndex == ${t}) { return _X${t}(indices); }`);return n.push("	}"),n.join(`
`)},RA=r=>{let e=["int getSizeInConcatAxisValueFromIndex(int index) {"];for(let n=0;n<r.length;++n)n===0?e.push(`	if (index == ${n}) { return ${r[n]}; }`):n===r.length-1?e.push(`	else { return ${r[n]}; }`):e.push(`	else if (index == ${n}) { return ${r[n]}; }`);return e.push("	}"),e.join(`
`)},Qm=r=>xe({axis:r.attributes.getInt("axis")}),zA=r=>{if(!r||r.length<1)throw new Error("too few inputs");let e=r[0].type,n=r[0].dims.length;if(e==="string")throw new Error("string tensor is not supported yet");for(let t of r){if(t.type!==e)throw new Error("input tensors should be one type");if(t.dims.length!==n)throw new Error("input tensors should have the same shape")}}});function MA(){return Ut("abs")}function BA(){return Ut("acos")}function VA(){return Ut("asin")}function GA(){return Ut("atan")}function UA(){return Ut("ceil")}function FA(){return Ut("cos")}function WA(r){return{body:`
  const float alpha = float(${r});

  float elu_(float a) {
    return a >= 0.0 ? a: (exp(a) - 1.0) * alpha;
  }
  vec4 elu_(vec4 v) {
    return vec4(elu_(v.x), elu_(v.y), elu_(v.z), elu_(v.w));
  }
  `,name:"elu",type:0}}function HA(){return Ut("exp")}function qA(){return Ut("floor")}function El(r,e){let n="clip";return{body:`
  const float min = float(${r});
  const float max = float(${e});

  float ${n}_(float a) {
    return clamp(a, min, max);
  }
  vec4 ${n}_(vec4 v) {
    return clamp(v, min, max);
  }
  `,name:n,type:0}}function jA(){let r="indentity";return{body:`
  float ${r}_(float a) {
    return a;
  }
  vec4 ${r}_(vec4 v) {
    return v;
  }
  `,name:r,type:0}}function KA(r){let e="leakyRelu";return{body:`
  const float alpha = float(${r});

  float ${e}_(float a) {
    return a < 0.0 ? a * alpha : a;
  }
  vec4 ${e}_(vec4 v) {
    return vec4(${e}_(v.x), ${e}_(v.y), ${e}_(v.z), ${e}_(v.w));
  }
  `,name:e,type:0}}function XA(){return Ut("log")}function ZA(){return{body:`
  float neg_(float a) {
    return -a;
  }
  vec4 neg_(vec4 v) {
    return -v;
  }
  `,name:"neg",type:0}}function JA(){return{body:`
  float not_(float a) {
    return float( ! bool(a) );
  }
  bool not_(bool a) {
    return !a;
  }
  vec4 not_(vec4 v) {
    return vec4(!bool(v.x), !bool(v.y), !bool(v.z), !bool(v.w));
  }
  bvec4 not_(bvec4 v) {
    return bvec4(!v.x, !v.y, !v.z, !v.w);
  }
  `,name:"not",type:0}}function YA(){return Ut("sin")}function Cl(){let r="relu";return{body:`
  float ${r}_(float a) {
    return max( a, 0.0 );
  }
  vec4 ${r}_(vec4 v) {
    return max( v, 0.0 );
  }
  `,name:r,type:0}}function Dl(){let r="sigmoid";return{body:`
  float ${r}_(float a) {
    return 1.0 / (1.0 + exp(-a));
  }
  vec4 ${r}_(vec4 v) {
    return 1.0 / (1.0 + exp(-v));
  }
  `,name:r,type:0}}function QA(){return Ut("sqrt")}function eO(){return Ut("tan")}function tO(){let r="tanh";return{body:`
  float ${r}_(float a) {
    a = clamp(a, -10., 10.);
    a = exp(2.*a);
    return (a - 1.) / (a + 1.);
  }
  vec4 ${r}_(vec4 v) {
    v = clamp(v, -10., 10.);
    v = exp(2.*v);
    return (v - 1.) / (v + 1.);
  }
  `,name:r,type:0}}function Ut(r){return{body:`
  float ${r}_(float a) {
    return ${r}(a);
  }
  vec4 ${r}_(vec4 v) {
    return ${r}(v);
  }
  `,name:r,type:0}}var nO,ot,tg,ng,rg,og,kl,ig,ag,rO,sg,ug,lg,cg,dg,pg,Nl,fg,hg,mg,gg,bg,yg,_g,wg,vg,xg,Tg,Ll=L(()=>{"use strict";pt();Be();Yn();Qe();Pe();nO=(r,e,n,t)=>{let o=r.session.pack?2:0,i=le(r.session.backend.glContext.version);return{...e,output:{dims:n.dims,type:n.type,textureType:o},shaderSource:`
     ${t.body}
     void main() {
       vec4 v = ${i.texture2D}(A, TexCoords);
       v = ${t.name}_(v);
       ${i.output} = v;
     }
     `,hasMain:!0}},ot=(r,e,n,t)=>{let o=r.session.pack?2:0,i={name:n.name,inputTypes:[o],inputNames:["A"],cacheHint:t};return{...i,get:()=>nO(r,i,e,n)}},tg=(r,e)=>[r.run(ot(r,e[0],MA()),e)],ng=(r,e)=>[r.run(ot(r,e[0],BA()),e)],rg=(r,e)=>[r.run(ot(r,e[0],VA()),e)],og=(r,e)=>[r.run(ot(r,e[0],GA()),e)],kl=(r,e,n)=>[r.run(ot(r,e[0],El(n.min,n.max),n.cacheKey),e)],ig=r=>xe({min:r.attributes.getFloat("min",Dr),max:r.attributes.getFloat("max",kr)}),ag=(r,e)=>{let n=rO(r,e);return kl(r,[e[0]],n)},rO=(r,e)=>{if(e.length>=3&&(!r.session.isInitializer(e[1].dataId)||!r.session.isInitializer(e[2].dataId)))throw new Error("dynamic clip attributes are not allowed");let n=e.length>=3?e[1].numberData[0]:Dr,t=e.length>=3?e[2].numberData[0]:kr;return xe({min:n,max:t})},sg=(r,e)=>[r.run(ot(r,e[0],UA()),e)],ug=(r,e)=>[r.run(ot(r,e[0],FA()),e)],lg=(r,e,n)=>[r.run(ot(r,e[0],WA(n.alpha),n.cacheKey),e)],cg=r=>xe({alpha:r.attributes.getFloat("alpha",1)}),dg=(r,e)=>[r.run(ot(r,e[0],HA()),e)],pg=(r,e)=>[r.run(ot(r,e[0],qA()),e)],Nl=(r,e)=>[r.run(ot(r,e[0],jA()),e)],fg=(r,e,n)=>[r.run(ot(r,e[0],KA(n.alpha),n.cacheKey),e)],hg=r=>xe({alpha:r.attributes.getFloat("alpha",.01)}),mg=(r,e)=>[r.run(ot(r,e[0],XA()),e)],gg=(r,e)=>[r.run(ot(r,e[0],ZA()),e)],bg=(r,e)=>[r.run(ot(r,e[0],JA()),e)],yg=(r,e)=>[r.run(ot(r,e[0],Cl()),e)],_g=(r,e)=>[r.run(ot(r,e[0],Dl()),e)],wg=(r,e)=>[r.run(ot(r,e[0],YA()),e)],vg=(r,e)=>[r.run(ot(r,e[0],QA()),e)],xg=(r,e)=>[r.run(ot(r,e[0],eO()),e)],Tg=(r,e)=>[r.run(ot(r,e[0],tO()),e)]});function Bn(r){let e;switch(r.activation){case"Relu":e=Cl();break;case"Sigmoid":e=Dl();break;case"Clip":e=El(r.clipMin,r.clipMax);break;default:return{activationFunction:"",applyActivation:""}}let n=e.name,t=e.body,o=`value = ${n}_(value);`;return{activationFunction:t,applyActivation:o}}var oo,Rr=L(()=>{"use strict";Be();Ll();oo=r=>{let e=r.getString("activation","");if(e==="Clip"){let[n,t]=r.getFloats("activation_params",[Dr,kr]);return{activation:e,clipMax:t,clipMin:n,activationCacheKey:`${e}:${n},${t}`}}return{activation:e,activationCacheKey:e}}});var iO,aO,Ig,Sg=L(()=>{"use strict";Dt();Qe();Pe();Xi();Rr();iO=(r,e)=>({name:"GroupedConv",inputNames:r?["X","W","Bias"]:["X","W"],inputTypes:r?[0,0,0]:[0,0],cacheHint:e}),aO=(r,e,n,t)=>{let i=e.length>2?"value += getBias(output_channel);":"",a=e[0].dims.slice(),s=e[1].dims.slice(),u=s[0]/t.group;Ge.verbose("GroupedConv",`autpPad:${t.autoPad}, dilations:${t.dilations}, group:${t.group}, kernelShape:${t.kernelShape}, pads:${t.pads}, strides:${t.strides}`);let l=io(a,s,t.dilations,t.pads,t.strides),d=le(r.session.backend.glContext.version),{activationFunction:p,applyActivation:h}=Bn(t),g=`
  const ivec2 strides = ivec2(${t.strides[0]}, ${t.strides[1]});
  const ivec2 pads = ivec2(${t.pads[0]}, ${t.pads[1]});
  ${p}
  void main() {
    ivec4 coords = getOutputCoords();
    int batch = coords.x;
    int output_channel = coords.y;
    ivec2 xRCCorner = coords.zw * strides - pads;
    int group_id = output_channel / ${u};

    float value = 0.0;
    for (int wInChannel = 0; wInChannel < ${s[1]}; wInChannel++) {
      int input_channel = group_id * ${s[1]} + wInChannel;
      for (int wHeight = 0; wHeight < ${s[2]}; wHeight++) {
        int xHeight = xRCCorner.x + wHeight * ${t.dilations[0]};

        if (xHeight < 0 || xHeight >= ${a[2]}) {
          continue;
        }

        for (int wWidth = 0; wWidth < ${s[3]}; wWidth++) {
          int xWidth = xRCCorner.y + wWidth * ${t.dilations[1]};
          if (xWidth < 0 || xWidth >= ${a[3]}) {
            continue;
          }

          float xVal = getX(batch, input_channel, xWidth, xHeight);
          float wVal = getW(output_channel, wInChannel, wWidth, wHeight);
          value += xVal*wVal;
        }
      }
    }
    ${i}
    ${h}
    ${d.output} = vec4(value, .0, .0, .0);
  }
`;return{...n,output:{dims:l,type:e[0].type,textureType:0},shaderSource:g,hasMain:!0}},Ig=(r,e,n)=>{let t=iO(e.length>2,n.cacheKey);return{...t,get:()=>aO(r,e,t,n)}}});var sO,uO,$g,Ag=L(()=>{"use strict";Qe();Pe();Lr();sO=r=>({name:"Im2Col (packed)",inputNames:["A"],inputTypes:[2],cacheHint:r}),uO=(r,e,n,t,o,i)=>{let a=n.dims,s=t.dims,u=2,l=3,d=o.length,p=[s[1]*s[2]*s[3],o[2]*o[3]],h=s[2]*s[3],g=Mn(),b=le(r.session.backend.glContext.version),_="";for(let v=0;v<=1;v++)for(let x=0;x<=1;x++)_+=`
            blockIndex = rc.x + ${x};
            pos = rc.y + ${v};

            if(blockIndex < ${p[1]} && pos < ${p[0]}) {
              offsetY = int(blockIndex / (${o[d-1]})) * ${i.strides[0]} -
                ${i.pads[0]};
              d0 = offsetY + ${i.dilations[0]} * (imod(pos, ${h}) / ${s[2]});

              if(d0 < ${a[u]} && d0 >= 0) {
                offsetX = imod(blockIndex, ${o[d-1]}) * ${i.strides[1]} -
                  ${i.pads[1]};
                d1 = offsetX + ${i.dilations[1]} * imod(imod(pos, ${h}), ${s[2]});

                if(d1 < ${a[l]} && d1 >= 0) {

                  ch = int(float(pos)/ ${h}.);
                    innerDims = vec2(d0, d1);
                    result[${v*2+x}] = getChannel(
                      getA(0, ch, int(innerDims.x),
                      int(innerDims.y)), innerDims);
                }
              }
            }

          `;let S=`
      ${g}

      void main() {
        ivec2 rc = getOutputCoords();
          vec4 result = vec4(0.0);
          int blockIndex, pos, offsetY, d0, offsetX, d1, ch;
          vec2 innerDims;
          ${_}
          ${b.output} = result;
      }
            `;return{...e,output:{dims:p,type:n.type,textureType:2},shaderSource:S,hasMain:!0}},$g=(r,e,n,t,o)=>{let i=sO(o.cacheKey);return{...i,get:()=>uO(r,i,e,n,t,o)}}});function cO(r,e,n){let t=e[0].dims,o=e[1].dims,i=bt.calcShape(t,o,!0);if(!i)throw new Error("Can't use matmul on the given tensors");let a=yt(i.length),s=Xt(),{activationFunction:u,applyActivation:l}=Bn(n),d=e.length>2,p=d?"value += getBiasForMatmul();":"",h=d?`${zl(a,s,e[2].dims,i,!1)}`:"",g=i.length,b=t.length,_=o.length,S=t[t.length-1],v=`
    ${u}
    ${h}
    float process(int indices[${g}]) {
        int a[${b}];
        int b[${_}];
        bcastMatmulIndices_A(indices, a);
        bcastMatmulIndices_B(indices, b);

        float value;
        for (int k=0; k<${S}; ++k) {
            a[${b-1}] = k;
            b[${_-2}] = k;
            value += _A(a) * _B(b);
        }
        ${p}
        ${l}
        return value;
    }`;return{...r,output:{dims:i,type:e[0].type,textureType:0},shaderSource:v}}function Rl(r,e){let n=lO(r.length>2,e.activationCacheKey);return{...n,get:()=>cO(n,r,e)}}function zl(r,e,n,t,o){let i="",a=n.length,s=t.length,u=s-a;s<2&&a>0?i="coords":i=n.map((_,S)=>`coords.${e[S+u]}`).join(", ");let d=bt.getBroadcastDims(n,t).map(_=>`coords.${e[_+u]} = 0;`).join(`
`),h=ae.size(n)===1,g="vec4(outputValue.xx, outputValue.yy)";return h&&(g="vec4(outputValue.x)"),o?`
vec4 getBiasForMatmul() {
  ${r} coords = getOutputCoords();
  ${d}
  vec4 outputValue = getBias(${i});
  return ${g};
}`:`
float getBiasForMatmul() {
  ${r} coords = getOutputCoords();
  ${d}
  return getBias(coords.x);
}`}var Og,Pg,lO,dO,Zi=L(()=>{"use strict";Be();Pe();zn();Rr();Ml();Og=(r,e,n)=>(dO(e),r.session.pack?[r.run(Ji(r,e,n),e)]:[r.run(Rl(e,n),e)]),Pg=r=>oo(r.attributes),lO=(r,e)=>({name:"MatMul",inputNames:r?["A","B","Bias"]:["A","B"],inputTypes:r?[0,0,0]:[0,0],cacheHint:e});dO=r=>{if(!r||r.length!==2)throw new Error("MatMul requires 2 inputs.");if(r[0].dims[r[0].dims.length-1]!==r[1].dims[r[1].dims.length-2])throw new Error("shared dimension does not match.");if(r[0].type!=="float32"&&r[0].type!=="float64"||r[1].type!=="float32"&&r[1].type!=="float64")throw new Error("inputs should be float type");if(r[0].type!==r[1].type)throw new Error("inputs types should match")}});function hO(r,e,n,t){let o=[],i=[],a=n[0].dims,s=n[1].dims,u=a.length,l=s.length,d=t.length,p=d-u,h=d-l;o=a.map(($,O)=>`coords.${e[O+p]}`),o[u-1]="i*2",o.join(", "),i=s.map(($,O)=>`coords.${e[O+h]}`),i[l-2]="i*2",i.join(", ");let g=bt.getBroadcastDims(a,t),b=bt.getBroadcastDims(s,t),_=g.map($=>`coords.${e[$+p]} = 0;`).join(`
`),S=b.map($=>`coords.${e[$+h]} = 0;`).join(`
`),v=`int lastDim = coords.${e[d-1]};
  coords.${e[d-1]} = coords.${e[d-2]};
  coords.${e[d-2]} = lastDim;`;return`
vec4 getAAtOutCoordsMatmul(int i) {
  ${r} coords = getOutputCoords();
  ${v}
  ${_}
  vec4 outputValue = getA(${o});
  return outputValue;
}

vec4 getBAtOutCoordsMatmul(int i) {
  ${r} coords = getOutputCoords();
  ${v}
  ${S}
  vec4 outputValue = getB(${i});
  return outputValue;
}`}function mO(r,e){let n="";for(let t=0;t<e-2;t++)n+=`rc.${r[t]}, `;return n+=`rc.${r[e-2]}, i*2`,n}function gO(r,e){let n="";for(let t=0;t<e-2;t++)n+=`rc.${r[t]}, `;return n+=`i*2, rc.${r[e-1]}`,n}var pO,fO,Ji,Ml=L(()=>{"use strict";Be();Qe();Pe();zn();Rr();Zi();pO=(r,e)=>({name:"MatMul (packed)",inputNames:r?["A","B","Bias"]:["A","B"],inputTypes:r?[2,2,2]:[2,2],cacheHint:e}),fO=(r,e,n,t)=>{let o=n.length>2,i=o?"value += getBiasForMatmul();":"",a=n[0].dims,s=n[1].dims,u=bt.calcShape(a,s,!0),l=!ae.areEqual(n[0].dims,n[1].dims);if(!u)throw new Error("Can't use matmul on the given tensors");let d=a[a.length-1],p=Math.ceil(d/2),h=a.length,g=s.length,b=le(r.session.backend.glContext.version),_=yt(u.length),S=u.length,v=Xt(),{activationFunction:x,applyActivation:$}=Bn(t),O=o?`${zl(_,v,n[2].dims,u,!0)}`:"",E=l?`${hO(_,v,n,u)}`:"",D=l?"getAAtOutCoordsMatmul(i)":`getA(${mO(v,h)})`,B=l?"getBAtOutCoordsMatmul(i)":`getB(${gO(v,g)})`,T=l?"":`${_} rc =
          getOutputCoords(); int lastDim = rc.${v[S-1]}; rc.${v[S-1]} =
          rc.${v[S-2]}; rc.${v[S-2]} = lastDim;
      `,F=`
            ${E}
            ${O}
            ${x}
            void main() {
              ${T}

              vec4 value = vec4(0);
              for (int i = 0; i < ${p}; i++) {
                vec4 a = ${D};
                vec4 b = ${B};

                value += (a.rrbb * b.rgrg);
                value += (a.ggaa * b.baba);
              }
              ${i}
              ${$}
              ${b.output} = value;
            }`;return{...e,output:{dims:u,type:n[0].type,textureType:2},shaderSource:F,hasMain:!0}},Ji=(r,e,n)=>{let t=pO(e.length>2,n.activationCacheKey);return{...t,get:()=>fO(r,t,e,n)}}});var Eg,Cg=L(()=>{"use strict";Xi();Ag();Ml();Eg=(r,e,n)=>{let t=e[0].dims,o=e[1].dims,i=io(t,o,n.dilations,n.pads,n.strides),a=r.run($g(r,e[0],e[1],i,n),[e[0]]),s=r.reshapePacked(e[1],[o[0],o[1]*o[2]*o[3]]),u=e.length===3?[s,a,e[2]]:[s,a],l=r.run(Ji(r,u,n),u);return r.reshapePacked(l,i)}});var bO,yO,Dg,Bl,Vl=L(()=>{"use strict";Pe();bO=r=>({name:"Im2Col",inputNames:["X"],inputTypes:[0],cacheHint:r}),yO=(r,e,n,t,o,i)=>{let a=n.dims,s=t.dims,u=o.length,l=Bl(a,s,o,4),d=`
        const int XC = ${a[1]};
        const int XH = ${a[2]};
        const int XW = ${a[3]};
        const int KH = ${i.kernelShape[0]};
        const int KW = ${i.kernelShape[1]};
        const int dilationH = ${i.dilations[0]};
        const int dilationW = ${i.dilations[1]};
        const int strideH = ${i.strides[0]};
        const int strideW = ${i.strides[1]};
        const int padH = ${i.pads[0]};
        const int padW = ${i.pads[1]};
        const int KHKW = KH*KW;
        const int XCKHKW = XC * KHKW;
        const int outputChannels = 4;
        vec4 process(int indices[${u}]) {
          int b  = indices[0]; // batch size
          int oh = indices[1] * strideH - padH; //output height
          int ow = indices[2] * strideW - padW; //output width
          int p = indices[3] * outputChannels; //patch
          vec4 value = vec4(0.0);
          for(int i=0; i < outputChannels; ++i) {
            if(p < XCKHKW) {
              int patchC = p / KHKW;
              int patchH = (p - patchC*KHKW) / KW;
              int patchW = (p - patchC*KHKW) - patchH * KW;
              int xh2 = oh + patchH * dilationH;
              int xw2 = ow + patchW * dilationW;
              int x[${a.length}];
              x[0] = b;
              x[1] = patchC;
              x[2] = xh2;
              x[3] = xw2;
              if(xh2 >= 0 &&
                  xh2 < XH &&
                  xw2 >= 0 &&
                  xw2 < XW) {
                value[i] = _X(x);
              }
            }
            ++p;
          }
          return value;
        }
        `;return{...e,output:{dims:l,type:n.type,textureType:4},shaderSource:d}},Dg=(r,e,n,t,o)=>{let i=bO(o.cacheKey);return{...i,get:()=>yO(r,i,e,n,t,o)}},Bl=(r,e,n,t=4)=>[n[0],n[2],n[3],Math.ceil(r[1]*e[2]*e[3]/t)]});var _O,wO,kg,Ng=L(()=>{"use strict";Be();Qe();Pe();Rr();Vl();_O=(r,e)=>({name:"ConvDotProduct",inputNames:r?["Im2Col","K","B"]:["Im2Col","K"],inputTypes:r?[0,4,0]:[0,4],cacheKey:e.activationCacheKey}),wO=(r,e,n,t,o)=>{let i=n[0].dims,a=n[1].dims,s=[a[0],Math.ceil(i[1]*a[2]*a[3]/4)],u=Bl(i,a,t),[l,d]=r.calculateTextureWidthAndHeight(s,4),p=ae.computeStrides(u),[h,g]=r.calculateTextureWidthAndHeight(u,4),b=t.length,_=n.length<3?"0.0":"_B(b)",S=Math.ceil(i[1]*a[2]*a[3]/4),{activationFunction:v,applyActivation:x}=Bn(o),$=le(r.session.backend.glContext.version),O=`
${v}
float process(int indices[${b}]) {
  int b[1];
  b[0] = indices[1];
  int im2col[4];
  im2col[0] = indices[0];
  im2col[1] = indices[2];
  im2col[2] = indices[3];
  int im2colOffset = im2col[0] * ${p[0]} + im2col[1] * ${p[1]} + im2col[2] * ${p[2]};
  int kernelOffset = indices[1] * ${s[1]};
  float value = ${_};
  for (int i = 0; i < ${S}; ++i) {
    vec2 im2colCoords = offsetToCoords(im2colOffset, ${h}, ${g});
    vec2 kernelCoords = offsetToCoords(kernelOffset, ${l}, ${d});
    value += dot(${$.texture2D}(Im2Col, im2colCoords), ${$.texture2D}(K, kernelCoords));
    ++im2colOffset;
    ++kernelOffset;
  }
  ${x}
  return value;
}`;return{...e,output:{dims:t,type:n[0].type,textureType:0},shaderSource:O}},kg=(r,e,n,t)=>{let o=_O(e.length>2,t);return{...o,get:()=>wO(r,o,e,n,t)}}});var io,Gl,vO,xO,TO,IO,Ul,SO,Xi=L(()=>{"use strict";pt();Be();Sg();Cg();Ng();Rr();Vl();Zi();io=(r,e,n,t,o)=>{let i=r[0],a=r.slice(2),s=a.length,u=e[0],d=e.slice(2).map((b,_)=>b+(b-1)*(n[_]-1)),h=a.map((b,_)=>b+t[_]+t[_+s]).map((b,_)=>Math.floor((b-d[_]+o[_])/o[_]));return[i,u].concat(...h)},Gl=(r,e,n)=>(SO(e,n),vO(r,e,n)),vO=(r,e,n)=>{let t=IO(n,e),o=r.session.pack,i=t.kernelShape[0]===1&&t.kernelShape[1]===1;return t.group>1?[r.run(Ig(r,e,t),e)]:i&&o?[xO(r,e,t)]:o&&e[0].dims.length===4&&e[0].dims[0]===1&&!i?[Eg(r,e,t)]:[TO(r,e,t)]},xO=(r,e,n)=>{let t=e[0].dims,o=e[1].dims,i=io(t,o,n.dilations,n.pads,n.strides),a=r.reshapeUnpacked(e[0],[t[1],t[2]*t[3]]),s=r.reshapeUnpacked(e[1],[o[0],o[1]]),u=e.length>2?[s,a,e[2]]:[s,a],l=r.run(Rl(u,n),u);return r.reshapeUnpacked(l,i)},TO=(r,e,n)=>{let t=e[0].dims,o=e[1].dims,i=io(t,o,n.dilations,n.pads,n.strides),a=r.run(Dg(r,e[0],e[1],i,n),[e[0]]),s=e.length===3?[a,e[1],e[2]]:[a,e[1]];return r.run(kg(r,e,i,n),s)},IO=(r,e)=>{let n=r.kernelShape.slice();if(r.kernelShape.length===0)for(let i=2;i<e[1].dims.length;++i)n.push(e[1].dims[i]);let t=r.pads.slice();Cr.adjustPadsBasedOnAutoPad(e[0].dims,r.strides,r.dilations,n,t,r.autoPad);let o=Object.assign({},r);return Object.assign(o,{kernelShape:n,pads:t,cacheKey:r.cacheKey}),o},Ul=r=>{let e=r.attributes,n=oo(e),t=e.getString("auto_pad","NOTSET"),o=e.getInts("dilations",[1,1]),i=e.getInt("group",1),a=e.getInts("kernel_shape",[]),s=e.getInts("pads",[0,0,0,0]),u=e.getInts("strides",[1,1]);return xe({autoPad:t,dilations:o,group:i,kernelShape:a,pads:s,strides:u,...n})},SO=(r,e)=>{if(!r||r.length!==2&&r.length!==3)throw new Error("Conv requires 2 or 3 inputs");if(r[0].dims.length!==4||r[1].dims.length!==4)throw new Error("currently only support 2-dimensional conv");let n=r[0].dims[1],t=r[1].dims[1]*e.group;if(n!==t)throw new Error("FILTER_IN_CHANNEL should be equal to DATA_CHANNEL");if(r.length===3&&(r[2].dims.length!==1||r[1].dims[0]!==r[2].dims[0]))throw new Error("invalid bias");let o=r[0].dims.length-2;if(e.dilations.length!==o)throw new Error(`dilations should be ${o}D`);if(e.strides.length!==o)throw new Error(`strides should be ${o}D`);if(e.pads.length!==o*2)throw new Error(`pads should be ${o*2}D`);if(e.kernelShape.length!==0&&e.kernelShape.length!==r[1].dims.length-2)throw new Error("invalid kernel shape");if(r[0].type!=="float32"||r[1].type!=="float32")throw new Error("Conv input(X,W) should be float tensor");if(r.length===3&&r[2].type!=="float32")throw new Error("Conv input(bias) should be float tensor")}});var $O,AO,OO,Lg,PO,EO,CO,DO,kO,NO,Rg,LO,zg=L(()=>{"use strict";pt();Qe();Pe();Rr();$O=(r,e,n,t,o,i)=>(r-1)*e+n+(t-1)*o+1-i,AO=(r,e,n,t,o)=>{let i=Math.floor(r/2);e==="SAME_UPPER"?(n[t]=i,n[o]=r-i):e==="SAME_LOWER"&&(n[t]=r-i,n[o]=i)},OO=(r,e,n,t,o,i,a,s)=>{let u=r.length-2,l=s.length===0;for(let d=0;d<u;++d){let p=l?r[d+2]*i[d]:s[d],h=$O(r[d+2],i[d],o[d],e[d],n[d],p);AO(h,t,o,d,d+u),l&&s.push(i[d]*(r[d+2]-1)+a[d]+(e[d]-1)*n[d]+1-o[d]-o[d+u])}},Lg=(r,e,n)=>(LO(e,n),PO(r,e,n)),PO=(r,e,n)=>{let t=NO(n,e);return[kO(r,e,t)]},EO=(r,e)=>({name:"ConvTranspose",inputNames:r?["X","W","B"]:["X","W"],inputTypes:r?[0,0,0]:[0,0],cacheHint:e}),CO=(r,e,n,t)=>{let i=e.length>2?"getB(output_channel)":"0.0",a=e[0].dims,s=e[1].dims,u=s[1],l=s[0]/t.group,d=[e[0].dims[0],e[1].dims[1]*t.group,...t.outputShape],p=le(r.session.backend.glContext.version),{activationFunction:h,applyActivation:g}=Bn(t),b=`
  const ivec2 strides = ivec2(${t.strides[0]}, ${t.strides[1]});
  const ivec2 pads = ivec2(${t.pads[0]}, ${t.pads[1]});
  ${h}
  void main() {
    ivec4 coords = getOutputCoords();
    int batch = coords.x;
    int output_channel = coords.y;

    ivec2 loc = coords.zw + pads;

    int group_id = output_channel / ${u};
    int wOutChannel = output_channel - group_id * ${u};

    float value = ${i};
    for (int inChannelOffset = 0; inChannelOffset < ${l}; inChannelOffset++) {
      int input_channel = group_id * ${l} + inChannelOffset;
      for (int wWOff = 0; wWOff < ${s[2]}; wWOff++) {
        for (int wHOff = 0; wHOff < ${s[3]}; wHOff++) {
          ivec2 wOff = ivec2(wWOff * ${t.dilations[0]}, wHOff * ${t.dilations[1]});
          ivec2 wLoc = loc - wOff;
          ivec2 wLocIn = wLoc / strides;
          if (
            wLocIn * strides == wLoc &&
            wLocIn.x >= 0 && wLocIn.x < ${a[2]} &&
            wLocIn.y >= 0 && wLocIn.y < ${a[3]}
          ) {
            float xVal = getX(batch, input_channel, wLocIn.y, wLocIn.x);
            float wVal = getW(input_channel, wOutChannel, wHOff, wWOff);
            value += xVal * wVal;
          }
        }
      }
    }
    ${g}
    ${p.output} = vec4(value, .0, .0, .0);
  }
`;return{...n,output:{dims:d,type:e[0].type,textureType:0},shaderSource:b,hasMain:!0}},DO=(r,e,n)=>{let t=EO(e.length>2,n.cacheKey);return{...t,get:()=>CO(r,e,t,n)}},kO=(r,e,n)=>r.run(DO(r,e,n),e),NO=(r,e)=>{let n=r.kernelShape.slice();if(r.kernelShape.length===0)for(let s=2;s<e[1].dims.length;++s)n.push(e[1].dims[s]);let t=r.pads.slice(),o=r.outputShape.slice(),i=e[0].dims;OO(i,n,r.dilations,r.autoPad,t,r.strides,r.outputPadding,o);let a=Object.assign({},r);return Object.assign(a,{kernelShape:n,pads:t,outputShape:o,cacheKey:r.cacheKey}),a},Rg=r=>{let e=r.attributes,n=oo(e),t=e.getString("auto_pad","NOTSET"),o=e.getInts("dilations",[1,1]),i=e.getInt("group",1),a=e.getInts("kernel_shape",[]),s=e.getInts("output_padding",[0,0]),u=e.getInts("output_shape",[]),l=e.getInts("pads",[0,0,0,0]),d=e.getInts("strides",[1,1]);return xe({autoPad:t,dilations:o,group:i,kernelShape:a,outputPadding:s,outputShape:u,pads:l,strides:d,...n})},LO=(r,e)=>{if(!r||r.length!==2&&r.length!==3)throw new Error("Conv requires 2 or 3 inputs");if(r[0].dims.length!==4||r[1].dims.length!==4)throw new Error("currently only support 2-dimensional conv");let n=r[0].dims[1],t=r[1].dims[0];if(n!==t)throw new Error("FILTER_IN_CHANNEL should be equal to DATA_CHANNEL");let o=r[1].dims[1]*e.group;if(r.length===3&&(r[2].dims.length!==1||r[2].dims[0]!==o))throw new Error("invalid bias");let i=r[0].dims.length-2;if(e.dilations.length!==i)throw new Error(`dilations should be ${i}D`);if(e.strides.length!==i)throw new Error(`strides should be ${i}D`);if(e.pads.length!==i*2)throw new Error(`pads should be ${i*2}D`);if(e.outputPadding.length!==i)throw new Error(`output_padding should be ${i}D`);if(e.kernelShape.length!==0&&e.kernelShape.length!==r[1].dims.length-2)throw new Error("invalid kernel shape");if(e.outputShape.length!==0&&e.outputShape.length!==r[0].dims.length-2)throw new Error("invalid output shape");if(r[0].type!=="float32"||r[1].type!=="float32")throw new Error("ConvTranspose input(X,W) should be float tensor");if(r.length===3&&r[2].type!=="float32")throw new Error("ConvTranspose input(bias) should be float tensor")}});var Mg,zr,Bg,RO,Vg,zO,MO,BO,Yi=L(()=>{"use strict";pt();Be();Pe();Mg={name:"Transpose",inputNames:["A"],inputTypes:[0]},zr=(r,e,n)=>(BO(e),[r.run({...Mg,cacheHint:n.cacheKey,get:()=>RO(r,e[0],n.perm)},e)]),Bg=r=>xe({perm:r.attributes.getInts("perm",[])}),RO=(r,e,n)=>{let t=e.dims;n=Vg(t,n);let o=zO(t,n),i=t.length,a=`
      ${MO("perm",n,i)}
      float process(int indices[${i}]) {
        int a[${i}];
        perm(a, indices);
        return _A(a);
      }`;return{...Mg,output:{dims:o,type:e.type,textureType:0},shaderSource:a}},Vg=(r,e)=>(e&&e.length!==r.length&&(e=[...r.keys()].reverse()),e),zO=(r,e)=>(e=Vg(r,e),ae.sortBasedOnPerm(r,e)),MO=(r,e,n)=>{let t=[];t.push(`void ${r}(out int a[${n}], int src[${n}]) {`);for(let o=0;o<n;++o)t.push(`	a[${e[o]}]=src[${o}];`);return t.push("	}"),t.join(`
`)},BO=r=>{if(!r||r.length!==1)throw new Error("Transpose requires 1 input.");if(r[0].type!=="float32"&&r[0].type!=="float64")throw new Error("input should be float tensor")}});var Gg,Ug,VO,Fg=L(()=>{"use strict";Yi();Gg=(r,e,n)=>{VO(e);let t=n.blocksize,o=t*t,i=n.mode==="DCR"?[0,3,4,1,5,2]:[0,1,4,2,5,3],a=n.mode==="DCR"?[e[0].dims[0],t,t,e[0].dims[1]/o,e[0].dims[2],e[0].dims[3]]:[e[0].dims[0],e[0].dims[1]/o,t,t,e[0].dims[2],e[0].dims[3]],s=r.reshapeUnpacked(e[0],a),u={perm:i,cacheKey:`${i}`},[l]=zr(r,[s],u),d=[e[0].dims[0],e[0].dims[1]/o,e[0].dims[2]*t,e[0].dims[3]*t];return[r.reshapeUnpacked(l,d)]},Ug=r=>{let e=r.attributes.getInt("blocksize");if(e<1)throw new Error(`blocksize must be >= 1, but got : ${e} for DepthToSpace`);let n=r.attributes.getString("mode","DCR");if(n!=="DCR"&&n!=="CRD")throw new Error(`unrecognized mode: ${n} for DepthToSpace`);return{mode:n,blocksize:e}},VO=r=>{if(r.length!==1)throw new Error(`DepthToSpace expect 1 inputs, but got ${r.length}`);if(r[0].type==="string"||r[0].dims.length!==4)throw new TypeError("DepthToSpace input should be a 4-D numeric tensor")}});var Wg,Hg,GO,qg=L(()=>{"use strict";Be();Wg=(r,e,n)=>{GO(e,n);let t=ae.flattenShape(e[0].dims,n);return[r.reshapeUnpacked(e[0],t)]},Hg=r=>r.attributes.getInt("axis",1),GO=(r,e)=>{if(!r||r.length!==1)throw new Error("Flatten requires 1 input.");let n=r[0].dims.length;if(n===0)throw new Error("scalar tensor is not supported.");if(e<-n||e>n)throw new Error("Invalid axis");if(r[0].type==="string")throw new Error("string tensor is not supported.")}});var hr,zo=L(()=>{"use strict";hr=["float32","float64","int32","int16","int8","uint16","uint32","uint8"]});var jg,Kg,UO,FO,WO,HO,Xg=L(()=>{"use strict";pt();zo();Be();Pe();jg=(r,e,n)=>(HO(e,n.axis),[r.run(WO(r,e,n),e)]),Kg=r=>xe({axis:r.attributes.getInt("axis",0)}),UO={name:"Gather",inputNames:["A","B"],inputTypes:[0,0]},FO=(r,e,n,t)=>{let o=n[0].dims.slice(),i=n[1].dims.slice(),a=new Array(o.length+i.length-1);t=ae.normalizeAxis(t,o.length);let s=[];for(let h=0;h<a.length;h++)h<t?(a[h]=o[h],s.push(`inputIdx[${h}] = outputIdx[${h}];`)):h<t+i.length?(a[h]=i[h-t],s.push(`indexDataIdx[${h-t}] = outputIdx[${h}];`)):(a[h]=o[h-i.length+1],s.push(`inputIdx[${h-i.length+1}] = outputIdx[${h}];`));let u=a.length||1,l=o.length,d=i.length||1,p=`
      float process(int outputIdx[${u}]) {
        int inputIdx[${l}];
        int indexDataIdx[${d}];
        indexDataIdx[0] = 0;
        ${s.join(`
        `)}
        int idx = int(_B(indexDataIdx));
        inputIdx[${t}] = idx < 0 ? idx + ${o[t]} : idx;
        return _A(inputIdx);
      }`;return{...e,output:{dims:a,type:n[0].type,textureType:0},shaderSource:p}},WO=(r,e,n)=>{let t={...UO,cacheHint:n.cacheKey};return{...t,get:()=>FO(r,t,e,n.axis)}},HO=(r,e)=>{if(!r||r.length!==2)throw new Error("Gather requires 2 inputs.");let n=r[0].dims.length;if(n<1)throw new Error("Invalid input shape.");if(e<-n||e>n-1)throw new Error("Invalid axis.");if(hr.indexOf(r[0].type)===-1)throw new Error("Invaid input type.");if(r[1].type!=="int32"&&r[1].type!=="int16")throw new Error("Invaid input type.")}});var Fl,Zg,Jg,Yg,qO,jO,KO,Qg=L(()=>{"use strict";pt();Be();Pe();Fl=(r,e,n)=>(KO(e,n),[r.run(qO(e,n),e)]),Zg=(r,e)=>{let n=r.attributes.getInt("transA",0)!==0,t=r.attributes.getInt("transB",0)!==0,o=r.attributes.getFloat("alpha",1),i=r.attributes.getFloat("beta",1);return xe({transA:n,transB:t,alpha:o,beta:i,isOptionalC:e})},Jg=r=>Zg(r,!1),Yg=r=>Zg(r,!0),qO=(r,e)=>{let n={name:"Gemm",inputNames:r.length===3?["A","B","C"]:["A","B"],inputTypes:r.length===3?[0,0,0]:[0,0],key:e.cacheKey};return{...n,get:()=>jO(n,r,e)}},jO=(r,e,n)=>{let t=e[0].dims.slice(),o=e[1].dims.slice(),[i,a]=Gi.getShapeOfGemmResult(t,n.transA,o,n.transB,e.length===3?e[2].dims:void 0),s=[i,a];if(!s)throw new Error("Can't use gemm on the given tensors");let u=t[t.length-1],l="";n.transA&&(u=t[0]),n.transA&&n.transB?l="value += _A_T(a) * _B_T(b);":n.transA&&!n.transB?l="value += _A_T(a) * _B(b);":!n.transA&&n.transB?l="value += _A(a) * _B_T(b);":!n.transA&&!n.transB&&(l="value += _A(a) * _B(b);");let d=s.length,p=e.length===3?`int c[${e[2].dims.length}];`:"",h=e.length===3?"bcastIndices_C(indices, c);":"",g=e.length===3?"value += beta * _C(c);":"",b=`
      float process(int indices[${d}]) {
          int a[${d}];
          int b[${d}];
          ${p}

          copyVec(indices, a);
          copyVec(indices, b);
          ${h}

          float value = 0.0;
          for (int k=0; k<${u}; ++k) {
              a[${d-1}] = k;
              b[${d-2}] = k;
              ${l}
          }

          value = value * alpha;
          ${g}
          return value;
      }`;return{...r,output:{dims:s,type:e[0].type,textureType:0},variables:[{name:"alpha",type:"float",data:n.alpha},{name:"beta",type:"float",data:n.beta}],shaderSource:b}},KO=(r,e)=>{if(!r)throw new Error("Input is missing");if(e.isOptionalC&&(r.length<2||r.length>3))throw new Error("Invaid input shape.");if(!e.isOptionalC&&r.length!==3)throw new Error("Gemm requires 3 inputs");if(r.length===3&&r[2].dims.length!==1&&r[2].dims.length!==2)throw new Error("Invalid input shape of C");if(r[0].type!=="float32"&&r[0].type!=="float64"||r[1].type!=="float32"&&r[1].type!=="float64"||r.length===3&&r[2].type!=="float32"&&r[2].type!=="float64")throw new Error("Invalid input type.");if(r[0].type!==r[1].type||r.length===3&&r[0].type!==r[2].type)throw new Error("Input types are mismatched")}});var eb,tb,XO,ZO,JO,YO,QO,nb=L(()=>{"use strict";pt();Pe();eb=(r,e,n)=>(QO(e),[r.run(JO(r,e,n),e)]),tb=r=>{let e=r.attributes.getFloat("scale"),n=r.attributes.getFloats("bias");return xe({scale:e,bias:n})},XO={name:"ImageScaler",inputNames:["X"],inputTypes:[0]},ZO=(r,e,n,t)=>{let o=n[0].dims.slice(),i=o.length,s=`
      ${YO(t.bias.length)}
      float process(int indices[${i}]) {
        return _X(indices) * scale + getBias(bias, indices[1]);
      }`;return{...e,output:{dims:o,type:n[0].type,textureType:0},variables:[{name:"bias",type:"float",arrayLength:t.bias.length,data:t.bias},{name:"scale",type:"float",data:t.scale}],shaderSource:s}},JO=(r,e,n)=>{let t={...XO,cacheHint:n.cacheKey};return{...t,get:()=>ZO(r,t,e,n)}},YO=r=>{let e=[`float getBias(float bias[${r}], int channel) {`];for(let n=0;n<r;++n)n===0?e.push(`	if (channel == ${n}) { return bias[${n}]; }`):n===r-1?e.push(`	else { return bias[${n}]; }`):e.push(`	else if (channel == ${n}) { return bias[${n}]; }`);return e.push("	}"),e.join(`
`)},QO=r=>{if(!r||r.length!==1)throw new Error("ImageScaler requires 1 input.");if(r[0].dims.length!==4)throw new Error("Invalid input shape.");if(r[0].type!=="float32"&&r[0].type!=="float64")throw new Error("Invalid input type.")}});var ob,ib,rb,eP,tP,nP,rP,oP,iP,ab=L(()=>{"use strict";Qe();Pe();ob=(r,e,n)=>{iP(e);let t=r.run(tP(e[0]),e);return[r.run(oP(r,e[0],n,t.dims),[e[0],t,e[1],e[2]])]},ib=r=>r.attributes.getFloat("epsilon",1e-5),rb={name:"InstanceNormalization_MeanAndVariance",inputNames:["X"],inputTypes:[0]},eP=(r,e)=>{let n=e.dims.slice(),t=n[1],o=n[2]*n[3],i=[n[0],t],a=`
      vec4 process(int[2] indices) {
        vec4 v = vec4(0.0);
        int a[4];
        a[0] = indices[0];
        a[1] = indices[1];
        float temp = 0.0;
        for(int a2=0; a2<${n[2]}; a2++) {
          a[2] = a2;
          for(int a3=0; a3<${n[3]}; a3++) {
            a[3] = a3;
            float x = _X(a);
            temp += x;
          }
        }
        float mean = temp / float(${o});
        temp = 0.0;
        for(int a2=0; a2<${n[2]}; a2++) {
          a[2] = a2;
          for(int a3=0; a3<${n[3]}; a3++) {
            a[3] = a3;
            float x = _X(a);
            temp += (x - mean) * (x - mean);
          }
        }
        v.r = mean;
        v.g = temp / float(${o});

        return v;
      }`;return{...r,output:{dims:i,type:e.type,textureType:4},shaderSource:a}},tP=r=>({...rb,get:()=>eP(rb,r)}),nP={name:"InstanceNormalization_ComputeOutput",inputNames:["X","MeanAndVariance","Scale","B"],inputTypes:[0,4,0,0]},rP=(r,e,n,t,o)=>{let i=le(r.session.backend.glContext.version),[a,s]=r.calculateTextureWidthAndHeight(o,4),[u,l]=[a/4,s],d=`
      vec4 get_MeanAndVariance(int[2] mv) {
        int offset = indicesToOffset_MeanAndVariance(mv);
        vec2 coords = offsetToCoords(offset, ${u}, ${l});
        return ${i.texture2D}(MeanAndVariance, coords);
      }

      float process(int[4] indices) {
        int mv[2];
        mv[0] = indices[0];
        mv[1] = indices[1];
        vec4 mean_and_variance = get_MeanAndVariance(mv);
        float mean = mean_and_variance.r;
        float variance = mean_and_variance.g;

        int sb[1];
        sb[0] = indices[1];
        float scale = _Scale(sb);
        float b = _B(sb);

        return scale * (_X(indices) - mean) / sqrt(variance + epsilon) + b;
      }`;return{...e,output:{dims:n.dims,type:n.type,textureType:0},variables:[{name:"epsilon",type:"float",data:t}],shaderSource:d}},oP=(r,e,n,t)=>{let o={...nP,cacheHint:`${n}`};return{...o,get:()=>rP(r,o,e,n,t)}},iP=r=>{if(!r||r.length!==3)throw new Error("InstanceNormalization requires 3 inputs.");let e=r[0],n=r[1],t=r[2];if(e.dims.length<3||n.dims.length!==1||t.dims.length!==1)throw new Error("Invalid input shape.");if(n.dims[0]!==e.dims[1]||t.dims[0]!==e.dims[1])throw new Error("Input shapes are mismatched.");if(e.type!=="float32"&&e.type!=="float64"||n.type!=="float32"&&n.type!=="float64"||t.type!=="float32"&&t.type!=="float64")throw new Error("Invalid input type.");if(r[0].dims.length!==4)throw new Error("Only support 4-D input shape.")}});function aP(r,e){let n=r[0].dims[1],t=r[0].dims.length,o=-Math.floor((e.size-1)/2),i=Math.ceil((e.size-1)/2),a=`float(${e.alpha}) / float(${e.size})`,s=`float(${e.bias})`,u=`float(${e.beta})`,l=`
    float process(int indices[${t}]) {
        int c = indices[1];
        float x = _X(indices);
        float square_sum = 0.0;

        for (int i = ${o}; i <= ${i}; i++) {
          int idx = c + i;
          if (c >= 0 && c < ${n}) {
            indices[1] = idx;
            float j = _X(indices);
            square_sum += j * j;
          }
        }
        return x / pow(${s} + ${a} * square_sum, ${u});
    }`;return{...lb,cacheHint:e.cacheKey,output:{dims:r[0].dims,type:r[0].type,textureType:0},shaderSource:l}}function sP(r,e){return{...lb,cacheHint:e.cacheKey,get:()=>aP(r,e)}}var sb,ub,lb,uP,cb=L(()=>{"use strict";pt();Pe();sb=(r,e,n)=>(uP(e),[r.run(sP(e,n),e)]),ub=r=>{let e=r.attributes.getFloat("alpha",1e-4),n=r.attributes.getFloat("beta",.75),t=r.attributes.getFloat("bias",1),o=r.attributes.getInt("size");return xe({alpha:e,beta:n,bias:t,size:o})},lb={name:"LRN",inputNames:["X"],inputTypes:[0]};uP=r=>{if(!r||r.length!==1)throw new Error("LRN requires 1 input.");if(r[0].dims.length!==4)throw new Error('currently only support LRN for input with "NCHW" format');if(r[0].type!=="float32")throw new Error("input should be float type")}});var lP,Wl,db,pb,fb,cP,dP,pP,fP,hP,mP,gP,bP,hb=L(()=>{"use strict";pt();Be();Qe();Pe();lP={name:"Pad",inputNames:["A"],inputTypes:[0]},Wl=(r,e,n)=>(pP(e),[r.run({...lP,cacheHint:n.cacheKey,get:()=>dP(r,e[0],n)},e)]),db=r=>{let e=r.attributes.getString("mode","constant"),n=r.attributes.getFloat("value",0),t=r.attributes.getInts("pads");return xe({mode:e,value:n,pads:t})},pb=(r,e,n)=>{fP(e);let t=cP(r,e,n);return Wl(r,[e[0]],t)},fb=r=>r.attributes.getString("mode","constant"),cP=(r,e,n)=>{if(!r.session.isInitializer(e[1].dataId)||e.length>=3&&!r.session.isInitializer(e[2].dataId))throw new Error("dynamic pad attributes are not allowed");let t=Array.from(e[1].integerData),o=e.length>=3?e[2].floatData[0]:0;return xe({mode:n,pads:t,value:o})},dP=(r,e,n)=>{let t=ae.padShape(e.dims.slice(),n.pads),o=t.length,a=`
      ${hP(r,e,n)}
      float process(int[${o}] indices) {
          return padA(indices);
      }`;return{name:"Pad",inputNames:["A"],inputTypes:[0],output:{dims:t,type:e.type,textureType:0},shaderSource:a}},pP=r=>{if(!r||r.length!==1)throw new Error("Pad requires 1 input");if(r[0].type!=="float32"&&r[0].type!=="float64")throw new Error("Invalid input type.")},fP=r=>{if(!r||r.length!==2&&r.length!==3)throw new Error("Pad requires 2 or 3 inputs");if(r[1].type!=="int32")throw new Error("Invalid input type.");if(r.length>=3&&r[2].type==="string")throw new Error("Invalid input type.")},hP=(r,e,n)=>{let t=le(r.session.backend.glContext.version),[o,i]=r.calculateTextureWidthAndHeight(e.dims,0),a=ae.computeStrides(e.dims);switch(n.mode){case"constant":return mP(t,e.dims,a,o,i,n.pads,n.value);case"reflect":return gP(t,e.dims,a,o,i,n.pads);case"edge":return bP(t,e.dims,a,o,i,n.pads);default:throw new Error("Invalid mode")}},mP=(r,e,n,t,o,i,a)=>{let s=e.length,u="";for(let l=s-1;l>=0;--l)u+=`
        k = m[${l}] - ${i[l]};
        if (k < 0)  return constant;
        if (k >= ${e[l]}) return constant;
        offset += k * ${n[l]};
        `;return`
      float padA(int m[${s}]) {
        const float constant = float(${a});
        int offset = 0;
        int k = 0;
        ${u}
        vec2 coords = offsetToCoords(offset, ${t}, ${o});
        float value = getColorAsFloat(${r.texture2D}(A, coords));
        return value;
      }
      `},gP=(r,e,n,t,o,i)=>{let a=e.length,s="";for(let u=a-1;u>=0;--u)s+=`
        k = m[${u}] - ${i[u]};
        if (k < 0) { k = -k; }
        {
          const int _2n_1 = ${2*(e[u]-1)};
          k = int( mod( float(k), float(_2n_1) ) ) ;
          if(k >= ${e[u]}) { k = _2n_1 - k; }
        }
        offset += k * ${n[u]};
        `;return`
      float padA(int m[${a}]) {
        int offset = 0;
        int k = 0;
        ${s}
        vec2 coords = offsetToCoords(offset, ${t}, ${o});
        float value = getColorAsFloat(${r.texture2D}(A, coords));
        return value;
      }
      `},bP=(r,e,n,t,o,i)=>{let a=e.length,s="";for(let u=a-1;u>=0;--u)s+=`
        k = m[${u}] - ${i[u]};
        if (k < 0)  k = 0;
        if (k >= ${e[u]}) k = ${e[u]-1};
        offset += k * ${n[u]};
      `;return`
      float padA(int m[${a}]) {
        int offset = 0;
        int k = 0;
        ${s}
        vec2 coords = offsetToCoords(offset, ${t}, ${o});
        float value = getColorAsFloat(${r.texture2D}(A, coords));
        return value;
      }
      `}});var gb,bb,yb,_b,wb,vb,xb,Tb,Ib,yP,mb,Sb,ea,$b,Qi,_P,Ab=L(()=>{"use strict";pt();Be();Pe();gb=(r,e,n)=>{ea(e);let t={name:"AveragePool",inputNames:["X"],inputTypes:[0],cacheHint:n.cacheKey};return[r.run({...t,get:()=>yb(e,t,!1,n)},e)]},bb=r=>{let e=r.attributes.getString("auto_pad","NOTSET"),n=r.attributes.getInt("ceil_mode",0),t=r.attributes.getInt("count_include_pad",0)!==0,o=r.attributes.getInts("kernel_shape"),i=r.attributes.getInts("strides",[]),a=r.attributes.getInts("pads",[]);if(n!==0)throw new Error("using ceil() in shape computation is not yet supported for AveragePool");return xe({autoPad:e,ceilMode:n,countIncludePad:t,kernelShape:o,strides:i,pads:a})},yb=(r,e,n,t)=>{let[o,i]=Ib(r,t,n),a=ae.size(o.kernelShape),s="value += _X(x);",u="";o.countIncludePad?u+=`value /= float(${a});`:u+=`value /= float(${a} - pad);`;let d=`
        ${$b(r[0].dims,o,s,u,"0.0")}
      `;return{...e,output:{dims:i,type:r[0].type,textureType:0},shaderSource:d}},_b=(r,e,n)=>{ea(e);let t={name:"GlobalAveragePool",inputNames:["X"],inputTypes:[0],cacheHint:`${n.countIncludePad}`};return[r.run({...t,get:()=>yb(e,t,!0,n)},e)]},wb=r=>{let e=r.attributes.getInt("count_include_pad",0)!==0;return xe({autoPad:"",ceilMode:0,countIncludePad:e,kernelShape:[],strides:[],pads:[]})},vb=(r,e,n)=>{ea(e);let t={name:"MaxPool",inputNames:["X"],inputTypes:[0],cacheHint:n.cacheKey};return[r.run({...t,get:()=>Tb(e,t,!1,n)},e)]},xb=r=>{let e=r.attributes.getString("auto_pad","NOTSET"),n=r.attributes.getInt("ceil_mode",0),t=r.attributes.getInts("kernel_shape"),o=r.attributes.getInts("strides",[]),i=r.attributes.getInts("pads",[]),a=r.attributes.getInt("storage_order",0),s=r.attributes.getInts("dilations",[]);if(a!==0)throw new Error("column major storage order is not yet supported for MaxPool");if(n!==0)throw new Error("using ceil() in shape computation is not yet supported for MaxPool");return xe({autoPad:e,ceilMode:n,countIncludePad:!1,kernelShape:t,strides:o,pads:i,storageOrder:a,dilations:s})},Tb=(r,e,n,t)=>{let[o,i]=Ib(r,t,n),l=`
      ${$b(r[0].dims,o,`
      value = max(_X(x), value);
    `,"","-1e5")}
    `;return{...e,output:{dims:i,type:r[0].type,textureType:0},shaderSource:l}},Ib=(r,e,n)=>{let t=r[0].dims.slice(),o=Object.hasOwnProperty.call(e,"dilations"),i=e.kernelShape.slice(),a=e.strides.slice(),s=o?e.dilations.slice():[],u=e.pads.slice();Cr.adjustPoolAttributes(n,t,i,a,s,u);let l=Cr.computePoolOutputShape(n,t,a,s,i,u,e.autoPad),d=Object.assign({},e);return o?Object.assign(d,{kernelShape:i,strides:a,pads:u,dilations:s,cacheKey:e.cacheKey}):Object.assign(d,{kernelShape:i,strides:a,pads:u,cacheKey:e.cacheKey}),[d,l]},yP={autoPad:"",ceilMode:0,countIncludePad:!1,kernelShape:[],strides:[],pads:[],storageOrder:0,dilations:[],cacheKey:""},mb={name:"GlobalMaxPool",inputNames:["X"],inputTypes:[0]},Sb=(r,e)=>(ea(e),[r.run({...mb,get:()=>Tb(e,mb,!0,yP)},e)]),ea=r=>{if(!r||r.length!==1)throw new Error("Pool ops requires 1 input.");if(r[0].type!=="float32"&&r[0].type!=="float64")throw new Error("Invalid input type.")},$b=(r,e,n,t,o)=>{let i=r.length;if(e.kernelShape.length<=2){let a=e.kernelShape[e.kernelShape.length-1],s=e.strides[e.strides.length-1],u=e.pads[e.pads.length/2-1],l=e.pads[e.pads.length-1],d=r[i-1],p="",h="",g="";if(u+l!==0?p=`
          for (int i = 0; i < ${a}; i++) {
            x[${i} - 1] = indices[${i} - 1] * ${s} - ${u} + i;
            if (x[${i} - 1] < 0 || x[${i} - 1] >= ${d}) {
              pad++;
              continue;
            }
            ${n}
          }`:p=`
          for (int i = 0; i < ${a}; i++) {
            x[${i} - 1] = indices[${i} - 1] * ${s} - ${u} + i;
            ${n}
          }`,e.kernelShape.length===2){let _=e.kernelShape[e.kernelShape.length-2],S=e.strides[e.strides.length-2],v=e.pads[e.pads.length/2-2],x=e.pads[e.pads.length-2],$=r[i-2];v+x!==0?h=`
            for (int j = 0; j < ${_}; j++) {
              x[${i} - 2] = indices[${i} - 2] * ${S} - ${v} + j;
              if (x[${i} - 2] < 0 || x[${i} - 2] >= ${$}) {
                pad+= ${a};
                continue;
              }
          `:h=`
            for (int j = 0; j < ${_}; j++) {
              x[${i} - 2] = indices[${i} - 2] * ${S} - ${v} + j;
            `,g=`
          }
        `}return`
        float process(int indices[${i}]) {
          int x[${i}];
          copyVec(indices, x);

          float value = ${o};
          int pad = 0;
          ${h}
          ${p}
          ${g}
          ${t}
          return value;
        }
      `}else{let a=ae.size(e.kernelShape),s=ae.computeStrides(e.kernelShape),u=s.length,l=e.pads.length,d=_P(u),p=Qi(r,"inputDims"),h=Qi(e.pads,"pads"),g=Qi(s,"kernelStrides"),b=Qi(e.strides,"strides"),_=e.pads.reduce((x,$)=>x+$),S="";return _?S=`
            if (x[j] >= inputDims[j] || x[j] < 0) {
              pad++;
              isPad = true;
              break;
            }
          }
          if (!isPad) {
            ${n}
          }`:S=`
          }
          ${n}
        `,`
        ${d}
        float process(int indices[${i}]) {
          int x[${i}];
          copyVec(indices, x);
          int offset[${u}];
          int pads[${l}];
          int inputDims[${i}];
          int kernelStrides[${u}];
          int strides[${u}];
          ${h}
          ${p}
          ${b}
          ${g}

          float value = ${o};
          int pad = 0;
          bool isPad = false;
          for (int i = 0; i < ${a}; i++) {
            offsetToIndices(i, kernelStrides, offset);
            isPad = false;
            for (int j = ${i} - ${u}; j < ${i}; j++) {
              x[j] = indices[j] * strides[j - ${i} + ${u}]
                + offset[j - ${i} + ${u}] - pads[j - 2];
              ${S}
          }
          ${t}

          return value;
        }
      `}},Qi=(r,e)=>{let n="";for(let t=0;t<r.length;t++)n+=`
      ${e}[${t}] = ${r[t]};
    `;return n},_P=r=>`
  void offsetToIndices(int offset, int[${r}] strides, out int[${r}] indices) {
    if (${r} == 0) {
      return;
    }
    for (int i = 0; i < ${r} - 1; ++i) {
      indices[i] = offset / strides[i];
      offset -= indices[i] * strides[i];
    }
    indices[${r} - 1] = offset;
  }`});var Mr,mr,wP,vP,Ob,Pb,Eb,Cb,Db,kb,Nb,Lb=L(()=>{"use strict";pt();zo();Be();Pe();Mr=(r,e,n,t,o)=>{vP(e);let i={name:t,inputNames:["A"],inputTypes:[0]};return[r.run({...i,cacheHint:n.cacheKey,get:()=>wP(r,e,n,t,o,i)},e)]},mr=r=>{let e=r.attributes.getInts("axes",[]),n=r.attributes.getInt("keepdims",1)===1;return xe({axes:e,keepDims:n})},wP=(r,e,n,t,o,i)=>{let a=[],s=e[0].dims.length||1,u=[],l=ae.normalizeAxes(n.axes,e[0].dims.length),d=o(e,l),p=d[1];for(let b=0;b<e[0].dims.length;b++)l.indexOf(b)>=0||l.length===0?(n.keepDims&&a.push(1),p=`
          for(int j${b} = 0; j${b} < ${e[0].dims[b]}; j${b}++) {
            inputIdx[${b}] = j${b};
            ${p}
          }`):(u.push(`inputIdx[${b}] = outputIdx[${a.length}];`),a.push(e[0].dims[b]));let g=`
      float process(int outputIdx[${a.length||1}]) {
        float value;                 // final result
        int inputIdx[${s}];      // addressing input data
        ${u.join(`
`)}
        ${d[0]}       // init ops for reduce max/min
        ${p}
        ${d[2]}       // final computation for reduce mean
        return value;
      }`;return{...i,output:{dims:a,type:e[0].type,textureType:0},shaderSource:g}},vP=r=>{if(!r||r.length!==1)throw new Error("Reduce op requires 1 input.");if(hr.indexOf(r[0].type)===-1)throw new Error("Invalid input type.")},Ob=(r,e,n)=>Mr(r,e,n,"ReduceSum",()=>["value = 0.0;","value += _A(inputIdx);",""]),Pb=(r,e,n)=>Mr(r,e,n,"ReduceMean",(o,i)=>{let a=1;for(let s=0;s<o[0].dims.length;s++)(i.indexOf(s)>=0||i.length===0)&&(a*=o[0].dims[s]);return["value = 0.0;","value += _A(inputIdx);",`value /= ${a}.;`]}),Eb=(r,e,n)=>Mr(r,e,n,"ReduceMax",(o,i)=>{let a=[];for(let s=0;s<o[0].dims.length;s++)(i.indexOf(s)>=0||i.length===0)&&a.push(`inputIdx[${s}] = 0;`);return[`${a.join(`
`)}
value = _A(inputIdx);`,"value = max(value, _A(inputIdx));",""]}),Cb=(r,e,n)=>Mr(r,e,n,"ReduceMin",(o,i)=>{let a=[];for(let s=0;s<o[0].dims.length;s++)(i.indexOf(s)>=0||i.length===0)&&a.push(`inputIdx[${s}] = 0;`);return[`${a.join(`
`)}
value = _A(inputIdx);`,"value = min(value, _A(inputIdx));",""]}),Db=(r,e,n)=>Mr(r,e,n,"ReduceProd",()=>["value = 1.0;","value *= _A(inputIdx);",""]),kb=(r,e,n)=>Mr(r,e,n,"ReduceLogSum",()=>["value = 0.0;","value += _A(inputIdx);","value = log(value);"]),Nb=(r,e,n)=>Mr(r,e,n,"ReduceLogSumSquare",()=>["float t; value = 0.0;","t = _A(inputIdx); value += t * t;",""])});var Rb,zb=L(()=>{"use strict";Be();Rb=(r,e)=>{let n=ae.calculateReshapedDims(e[0].dims,e[1].integerData);return r.session.pack?[r.reshapePacked(e[0],n)]:[r.reshapeUnpacked(e[0],n)]}});var Mb,Hl,Bb,Vb,Mo,xP,ql,ta,jl=L(()=>{"use strict";pt();Qe();Pe();Mb={name:"Upsample",inputNames:["X"],inputTypes:[0]},Hl=(r,e,n)=>(ql(e,n),[r.run({...Mb,cacheHint:n.cacheKey,get:()=>xP(r,e,n)},e)]),Bb=r=>Mo(r,7),Vb=r=>Mo(r,9),Mo=(r,e)=>{let n=e>=10,t=r.attributes.getString("mode","nearest");if(t!=="nearest"&&t!=="linear"&&(e<11||t!=="cubic"))throw new Error(`unrecognized mode: ${t}`);let o=[];e<9&&(o=r.attributes.getFloats("scales"),ta(o,t,n));let i=r.attributes.getFloat("extrapolation_value",0),a=e>10?r.attributes.getString("coordinate_transformation_mode","half_pixel"):"asymmetric";if(["asymmetric","pytorch_half_pixel","tf_half_pixel_for_nn","align_corners","tf_crop_and_resize","half_pixel"].indexOf(a)===-1)throw new Error(`coordinate_transform_mode '${a}' is not supported`);let s=a==="tf_crop_and_resize",u=s,l=t==="nearest"&&e>=11?r.attributes.getString("nearest_mode","round_prefer_floor"):"";if(["round_prefer_floor","round_prefer_ceil","floor","ceil",""].indexOf(l)===-1)throw new Error(`nearest_mode '${l}' is not supported`);let d=r.attributes.getFloat("cubic_coeff_a",-.75),p=r.attributes.getInt("exclude_outside",0)!==0;if(p&&t!=="cubic")throw new Error("exclude_outside can be set to 1 only when mode is CUBIC.");let h=e<11?!0:t==="nearest"&&a==="asymmetric"&&l==="floor",g=0,b=0,_=0;return e>10?r.inputs.length>2?(g=1,b=2,_=3):(b=1,_=2):e===9&&(b=1),xe({opset:e,isResize:n,mode:t,scales:o,extrapolationValue:i,coordinateTransformMode:a,useExtrapolation:u,needRoiInput:s,nearestMode:l,cubicCoefficientA:d,excludeOutside:p,useNearest2xOptimization:h,roiInputIdx:g,scalesInputIdx:b,sizesInputIdx:_})},xP=(r,e,n)=>{let t=le(r.session.backend.glContext.version),[o,i]=r.calculateTextureWidthAndHeight(e[0].dims,0),a=e[0].dims.map((_,S)=>Math.floor(_*n.scales[S])),[s,u]=r.calculateTextureWidthAndHeight(a,0),l=a.length,d=new Array(l),p=new Array(l),h=`
      int output_pitches[${l}];
      int input_pitches[${l}];
      `;for(let _=l-1;_>=0;_--)d[_]=_===l-1?1:d[_+1]*a[_+1],p[_]=_===l-1?1:p[_+1]*e[0].dims[_+1],h+=`
        output_pitches[${_}] = ${d[_]};
        input_pitches[${_}] = ${p[_]};
        `;let g=`
      float getInputFloat(int index) {
        vec2 coords = offsetToCoords(index, ${o}, ${i});
        float value = getColorAsFloat(${t.texture2D}(X, coords));
        return value;
      }
      `,b=n.mode==="nearest"?`
    ${g}
    float process(int indices[${l}]) {
      int input_index = 0;
      int output_index = coordsToOffset(TexCoords, ${s}, ${u});

      ${h}

      int d, m;
      for (int dim = 0; dim < ${l}; ++dim) {
        d = output_index / output_pitches[dim];
        m = output_index - d * output_pitches[dim];
        output_index = m;

        if (scales[dim] != 1 && d > 0) {
          int d2 = d / scales[dim];
          m = d - d2 * scales[dim];
          d = d2;
        }
        input_index += input_pitches[dim] * d;
      }

      return getInputFloat(input_index);
    }`:l===4?`
    ${g}
    float process(int indices[4]) {
      int input_index = 0;
      int output_index = coordsToOffset(TexCoords, ${s}, ${u});

      ${h}

      int m;
      int index_of_dim0, index_of_dim1, index_of_dim2, index_of_dim3;
      index_of_dim0 = output_index / output_pitches[0];
      m = output_index - index_of_dim0 * output_pitches[0];
      index_of_dim1 = m / output_pitches[1];
      m = m - index_of_dim1 * output_pitches[1];
      index_of_dim2 = m / output_pitches[2];
      m = m - index_of_dim2 * output_pitches[2];
      index_of_dim3 = m;

      int index_of_input_dim2, index_of_input_dim3, x_offset, y_offset;
      index_of_input_dim2 = index_of_dim2 / scales[2];
      y_offset = index_of_dim2 - index_of_input_dim2 * scales[2];
      index_of_input_dim3 = index_of_dim3 / scales[3];
      x_offset = index_of_dim3 - index_of_input_dim3 * scales[3];

      input_index = index_of_dim0 * input_pitches[0] +
            index_of_dim1 * input_pitches[1] +
            index_of_input_dim2 * input_pitches[2] +
            index_of_input_dim3;

      float x00 = getInputFloat(input_index);
      float x10, x01, x11;

      bool end_of_dim2 = false;
      if (index_of_input_dim2 == (${e[0].dims[2]} - 1)) {
        // It's the end in dimension 2
        x01 = x00;
        end_of_dim2 = true;
      } else {
        x01 = getInputFloat(input_index + input_pitches[2]);
      }

      if (index_of_input_dim3 == (input_pitches[2] - 1)) {
        // It's the end in dimension 3
        x10 = x00;
        x11 = x01;
      }
      else {
        x10 = getInputFloat(input_index + 1);
        x11 = end_of_dim2 ? x10 : getInputFloat(input_index + input_pitches[2] + 1);
      }

      float y0 = x00 + float(y_offset) * (x01 - x00) / float(scales[2]);
      float y1 = x10 + float(y_offset) * (x11 - x10) / float(scales[2]);
      return y0 + float(x_offset) * (y1 - y0) / float(scales[3]);
    }`:`
    ${g}
    float process(int indices[2]) {
      int input_index = 0;
      int output_index = coordsToOffset(TexCoords, ${s}, ${u});

      ${h}

      int m;
      int index_of_dim0, index_of_dim1;
      index_of_dim0 = output_index / output_pitches[0];
      m = output_index - index_of_dim0 * output_pitches[0];
      index_of_dim1 = m;

      int index_of_input_dim0, index_of_input_dim1, x_offset, y_offset;
      index_of_input_dim0 = index_of_dim0 / scales[0];
      y_offset = index_of_dim0 - index_of_input_dim0 * scales[0];
      index_of_input_dim1 = index_of_dim1 / scales[1];
      x_offset = index_of_dim1 - index_of_input_dim1 * scales[1];

      input_index = index_of_input_dim0 * input_pitches[0] + index_of_input_dim1;

      float x00 = getInputFloat(input_index);
      float x10, x01, x11;

      bool end_of_dim0 = false;
      if (index_of_input_dim0 == (${e[0].dims[0]} - 1)) {
        // It's the end in dimension 0
        x01 = x00;
        end_of_dim0 = true;
      } else {
        x01 = getInputFloat(input_index + input_pitches[0]);
      }

      if (index_of_input_dim1 == (input_pitches[0] - 1)) {
        // It's the end in dimension 1
        x10 = x00;
        x11 = x01;
      }
      else {
        x10 = getInputFloat(input_index + 1);
        x11 = end_of_dim0 ? x10 : getInputFloat(input_index + input_pitches[0] + 1);
      }

      float y0 = x00 + float(y_offset) * (x01 - x00) / float(scales[0]);
      float y1 = x10 + float(y_offset) * (x11 - x10) / float(scales[0]);
      return y0 + float(x_offset) * (y1 - y0) / float(scales[1]);
    }`;return{...Mb,output:{dims:a,type:e[0].type,textureType:0},shaderSource:b,variables:[{name:"scales",type:"int",arrayLength:n.scales.length,data:n.scales.map(_=>Math.ceil(_))}]}},ql=(r,e)=>{if(!r||e.opset<9&&r.length!==1||e.opset>=9&&e.opset<11&&r.length!==2||e.opset>=11&&r.length<2)throw new Error("invalid inputs.");if(e.scales.length>0&&r[0].dims.length!==e.scales.length)throw new Error("Invalid input shape.");if(r[0].type==="string")throw new Error("Invalid input tensor types.")},ta=(r,e,n)=>{if(n){for(let t of r)if(t<=0)throw new Error("Scale value should be greater than 0.")}else for(let t of r)if(t<1)throw new Error("Scale value should be greater than or equal to 1.");if((e==="linear"||e==="cubic")&&r.length!==2&&(r.length!==4||r[0]!==1||r[1]!==1))throw new Error(`'Linear' mode and 'Cubic' mode only support 2-D inputs ('Bilinear', 'Bicubic')         or 4-D inputs with the corresponding outermost 2 scale values being 1         in the ${n?"Resize":"Upsample"} opeartor.`)}});var Kl,Xl,Gb,Ub,TP,IP,SP,$P,Fb=L(()=>{"use strict";Qe();Pe();zn();Lr();jl();Kl={name:"Resize",inputNames:["A"],inputTypes:[2]},Xl=(r,e,n)=>(ql(e,n),[r.run({...Kl,cacheHint:n.cacheKey,get:()=>TP(r,e,n)},e)]),Gb=r=>Mo(r,10),Ub=r=>Mo(r,11),TP=(r,e,n)=>{let t=le(r.session.backend.glContext.version),[o,i]=IP(e,n);if(o.every($=>$===1)&&n.coordinateTransformMode!=="tf_crop_and_resize")return{...Kl,output:{dims:i,type:e[0].type,textureType:2},hasMain:!0,shaderSource:`void main() {
                    vec4 v = ${t.texture2D}(X, TexCoords);
                    ${t.output} = v;
                }`};let s=i.length;if(s<2)throw new Error(`output dimension should be at least 2, but got ${s}`);let u=i[s-2],l=i[s-1],d=e[0].dims;if(s!==d.length)throw new Error(`output dimension should match input ${d.length}, but got ${s}`);let p=d[s-2],h=d[s-1],g=o[s-2],b=o[s-1],_="";if(n.mode!=="linear")throw new Error(`resize (packed) does not support mode: '${n.mode}'`);switch(n.coordinateTransformMode){case"asymmetric":_=`
                    vec4 getSourceFracIndex(ivec4 coords) {
                        return vec4(coords) / scaleWHWH;
                    }
                `;break;case"half_pixel":_=`
                    vec4 getSourceFracIndex(ivec4 coords) {
                        return (vec4(coords) + 0.5) / scaleWHWH - 0.5;
                    }
                `;break;case"pytorch_half_pixel":_=`
                    vec4 getSourceFracIndex(ivec4 coords) {
                        vec4 fcoords = vec4(coords);
                        return vec4(
                            ${l}.0 > 1.0 ? (fcoords.x + 0.5) / scaleWHWH.x - 0.5 : 0.0,
                            ${u}.0 > 1.0 ? (fcoords.y + 0.5) / scaleWHWH.y - 0.5 : 0.0,
                            ${l}.0 > 1.0 ? (fcoords.z + 0.5) / scaleWHWH.z - 0.5 : 0.0,
                            ${u}.0 > 1.0 ? (fcoords.w + 0.5) / scaleWHWH.w - 0.5 : 0.0
                          );
                    }
                `;break;case"align_corners":_=`
                    vec4 getSourceFracIndex(ivec4 coords) {
                        vec4 resized = vec4(${l}.0 - 1.0, ${u}.0 - 1.0, ${l}.0 - 1.0,
                            ${u}.0 - 1.0);
                        vec4 original = vec4(${h}.0 - 1.0, ${p}.0 - 1.0, ${h}.0 - 1.0,
                            ${p}.0 - 1.0);
                        vec4 new_scale = original / resized;
                        return vec4(coords) * new_scale;
                    }
                `;break;default:throw new Error(`resize (packed) does not support coordinateTransformMode:                                 '${n.coordinateTransformMode}'`)}let S=yt(s),v=Mn(),x=`
            const vec2 inputWH = vec2(${p}.0, ${h}.0);
            const vec4 scaleWHWH = vec4(float(${g}), float(${b}), float(${g}), float(${b}));
            ${v}
            ${_}
            float getAValue(int x10, int r, int c, int d) {
                return getChannel(getA(x10, r, c, d), vec2(c, d));
            }
            void main() {
                ${S} rc = getOutputCoords();

                int batch = rc[0];
                int depth = rc[1];

                // retrieve the 4 coordinates that is used in the 4 packed output values.
                ivec4 coords = ivec4(rc.wz, rc.w + 1, rc.z + 1);

                // calculate the source index in fraction
                vec4 sourceFrac = getSourceFracIndex(coords);

                // get the lower and upper bound of the 4 values that will be packed into one texel.
                ivec4 x00 = ivec4(max(sourceFrac.xy, vec2(0.0)), min(inputWH - 1.0, ceil(sourceFrac.xy)));
                ivec4 x01 = ivec4(max(sourceFrac.xw, vec2(0.0)), min(inputWH - 1.0, ceil(sourceFrac.xw)));
                ivec4 x10 = ivec4(max(sourceFrac.zy, vec2(0.0)), min(inputWH - 1.0, ceil(sourceFrac.zy)));
                ivec4 x11 = ivec4(max(sourceFrac.zw, vec2(0.0)), min(inputWH - 1.0, ceil(sourceFrac.zw)));

                bool hasNextRow = rc.w < ${u-1};
                bool hasNextCol = rc.z < ${l-1};

                // pack x00, x01, x10, x11's top-left corner into one vec4 structure
                vec4 topLeft = vec4(
                    getAValue(batch, depth, x00.x, x00.y),
                    hasNextCol ? getAValue(batch, depth, x01.x, x01.y) : 0.0,
                    hasNextRow ? getAValue(batch, depth, x10.x, x10.y) : 0.0,
                    (hasNextRow && hasNextCol) ? getAValue(batch, depth, x11.x, x11.y) : 0.0);

                // pack x00, x01, x10, x11's top-right corner into one vec4 structure
                vec4 topRight = vec4(
                    getAValue(batch, depth, x00.x, x00.w),
                    hasNextCol ? getAValue(batch, depth, x01.x, x01.w) : 0.0,
                    hasNextRow ? getAValue(batch, depth, x10.x, x10.w) : 0.0,
                    (hasNextRow && hasNextCol) ? getAValue(batch, depth, x11.x, x11.w) : 0.0);

                // pack x00, x01, x10, x11's bottom-left corner into one vec4 structure
                vec4 bottomLeft = vec4(
                    getAValue(batch, depth, x00.z, x00.y),
                    hasNextCol ? getAValue(batch, depth, x01.z, x01.y) : 0.0,
                    hasNextRow ? getAValue(batch, depth, x10.z, x10.y) : 0.0,
                    (hasNextRow && hasNextCol) ? getAValue(batch, depth, x11.z, x11.y) : 0.0);

                // pack x00, x01, x10, x11's bottom-right corner into one vec4 structure
                vec4 bottomRight = vec4(
                    getAValue(batch, depth, x00.z, x00.w),
                    hasNextCol ? getAValue(batch, depth, x01.z, x01.w) : 0.0,
                    hasNextRow ? getAValue(batch, depth, x10.z, x10.w) : 0.0,
                    (hasNextRow && hasNextCol) ? getAValue(batch, depth, x11.z, x11.w) : 0.0);

                // calculate the interpolation fraction on u and v direction
                vec4 frac = vec4(sourceFrac) - floor(sourceFrac);
                vec4 clampFrac = clamp(frac, vec4(0.0), vec4(1.0));

                vec4 top = mix(topLeft, topRight, clampFrac.ywyw);
                vec4 bottom = mix(bottomLeft, bottomRight, clampFrac.ywyw);
                vec4 newValue = mix(top, bottom, clampFrac.xxzz);

                ${t.output} = vec4(newValue);
            }
        `;return{...Kl,output:{dims:i,type:e[0].type,textureType:2},hasMain:!0,shaderSource:x}},IP=(r,e)=>{let t=r[0].dims,o=e.scales,i;if(o.length===0){let s=r[e.scalesInputIdx];if(s&&s.size!==0){if(r[e.sizesInputIdx])throw new Error("Only one of scales or sizes must be provided as input.");o=SP(s,e.mode,e.isResize)}else{let u=r[e.sizesInputIdx];if(!u||u.size===0)throw new Error("Either scales or sizes MUST be provided as input.");i=Array.from(u.integerData),o=$P(i,t,e.mode,e.isResize)}}else if(r[e.sizesInputIdx])throw new Error("Only one of scales or sizes must be provided as input.");let a=i||t.map((s,u)=>Math.floor(s*o[u]));return[o,a]},SP=(r,e,n)=>{let t=Array.from(r.floatData);return ta(t,e,n),t},$P=(r,e,n,t)=>{let o=e.length,i=new Array(o);for(let a=0,s=o;a<s;a++)if(e[a]===0){if(r[a]!==0)throw new Error("Input dim is zero but required output dim is non-zero.");i[a]=1}else i[a]=r[a]/e[a];return ta(i,n,t),i}});var Wb,AP,Hb=L(()=>{"use strict";Nr();Wb=(r,e)=>(AP(e),[new it([e[0].dims.length],"int32",void 0,void 0,new Int32Array(e[0].dims))]),AP=r=>{if(!r||r.length!==1)throw new Error("Shape requires 1 input.")}});var Zl,qb,jb,Kb,OP,Xb,PP,EP,Zb=L(()=>{"use strict";pt();zo();Be();Pe();Zl={name:"Slice",inputNames:["A"],inputTypes:[0]},qb=(r,e,n)=>(OP(e),[r.run({...Zl,cacheHint:n.cacheKey,get:()=>Kb(r,e[0],n)},e)]),jb=r=>{let e=r.attributes.getInts("starts"),n=r.attributes.getInts("ends"),t=r.attributes.getInts("axes",[]);return xe({starts:e,ends:n,axes:t})},Kb=(r,e,n)=>{let t=n.axes.length===0?e.dims.slice(0).map((p,h)=>h):n.axes,o=ae.normalizeAxes(t,e.dims.length),i=n.starts.map((p,h)=>p>e.dims[o[h]]-1?e.dims[o[h]]:ae.normalizeAxis(p,e.dims[o[h]])),a=n.ends.map((p,h)=>p>e.dims[o[h]]-1?e.dims[o[h]]:ae.normalizeAxis(p,e.dims[o[h]])),s=e.dims.slice(),u=[];for(let p=0;p<o.length;p++)s[o[p]]=a[p]-i[p],i[p]>0&&u.push(`outputIdx[${o[p]}] += ${i[p]};`);let d=`
      float process(int outputIdx[${s.length}]) {
        ${u.join(`
      `)}
        return _A(outputIdx);
      }`;return{...Zl,output:{dims:s,type:e.type,textureType:0},shaderSource:d}},OP=r=>{if(!r||r.length!==1)throw new Error("Slice requires 1 input.");if(hr.indexOf(r[0].type)===-1)throw new Error("Invalid input type.")},Xb=(r,e)=>{EP(e);let n=PP(r,e);return[r.run({...Zl,cacheHint:n.cacheKey,get:()=>Kb(r,e[0],n)},[e[0]])]},PP=(r,e)=>{if(!r.session.isInitializer(e[1].dataId)||!r.session.isInitializer(e[2].dataId)||e.length>=4&&!r.session.isInitializer(e[3].dataId)||e.length>=5&&!r.session.isInitializer(e[4].dataId))throw new Error("dynamic slice attributes are not allowed");if(e.length>=5&&e[4].integerData.some(a=>a!==1))throw new Error("currently non-1 steps is not supported for Slice");let n=Array.from(e[1].integerData),t=Array.from(e[2].integerData),o=e.length>=4?Array.from(e[3].integerData):[],i=`${o};${n};${t}`;return{starts:n,ends:t,axes:o,cacheKey:i}},EP=r=>{if(!r||r.length<3||r.length>5)throw new Error("Invalid input number.");if(r[1].type!=="int32"||r[1].dims.length!==1)throw new Error("Invalid input type.");if(r[2].type!=="int32"||r[2].dims.length!==1)throw new Error("Invalid input type.");if(r.length>=4&&(r[3].type!=="int32"||r[3].dims.length!==1))throw new Error("Invalid input type.");if(r.length>=5&&(r[4].type!=="int32"||r[4].dims.length!==1))throw new Error("Invalid input type.")}});var Jb,Yb,Qb,ey,ty,ny,ry,oy,CP,DP,kP,iy,ay=L(()=>{"use strict";pt();Be();Qe();Pe();Yi();Jb={name:"SoftmaxComputeMax",inputNames:["A"],inputTypes:[0]},Yb={name:"SoftmaxComputeScale",inputNames:["A","Max"],inputTypes:[0,0]},Qb={name:"SoftMax",inputNames:["A","Max","Norm"],inputTypes:[0,0,0]},ey=(r,e,n)=>{iy(e);let t=e[0].dims.slice(),o=ae.normalizeAxis(n.axis,t.length),i=ae.sizeToDimension(t,o),a=ae.sizeFromDimension(t,o);return oy(r,e,n,i,a)},ty=r=>xe({axis:r.attributes.getInt("axis",1)}),ny=r=>xe({axis:r.attributes.getInt("axis",-1)}),ry=(r,e,n)=>{iy(e);let t=e[0].dims.slice(),o=ae.normalizeAxis(n.axis,t.length),i=t.length,a=o!==i-1,s=[],u=[],l=[],d;a&&(u=Array.from({length:i}).map((b,_)=>_),u[o]=i-1,u[i-1]=o,u.map(b=>s.push(t[b])),d=xe({perm:u}),l=zr(r,e,d));let p=a?ae.sizeToDimension(s,i-1):ae.sizeToDimension(t,i-1),h=a?ae.sizeFromDimension(s,i-1):ae.sizeFromDimension(t,i-1),g=oy(r,a?l:e,n,p,h);return a?zr(r,g,d):g},oy=(r,e,n,t,o)=>{let i=CP(r,e[0],t,o,[t]),a=r.run({...Jb,cacheHint:n.cacheKey,get:()=>i},e),s=DP(r,e[0],t,o,i.output.dims,[t]),u=r.run({...Yb,cacheHint:n.cacheKey,get:()=>s},[e[0],a]),l=kP(r,e[0],t,o,i.output.dims,s.output.dims);return[r.run({...Qb,cacheHint:n.cacheKey,get:()=>l},[e[0],a,u])]},CP=(r,e,n,t,o)=>{let[i,a]=r.calculateTextureWidthAndHeight(e.dims,0),s=o.length;if(n<1||t<1)throw new Error("Logical row count N and feature count D must be greater than or equal to 1");if(o.length!==1)throw new Error("Dimensionality of the output should be 1");if(o[0]!==n)throw new Error("Shape of the output should be equal to logical row count");let u=le(r.session.backend.glContext.version),l=`
      float process(int[${s}] indices) {
        int logical_row_start_offset = indices[0] * ${t};

        float max = getColorAsFloat(${u.texture2D}(A, offsetToCoords(logical_row_start_offset, ${i},
        ${a} )));
        for(int i=1; i<${t}; ++i)
        {
          float current = getColorAsFloat(${u.texture2D}(A, offsetToCoords(logical_row_start_offset + i,
            ${i}, ${a})));
          if(current > max)
          max = current;
        }

        return max;
      }`;return{...Jb,output:{dims:o,type:e.type,textureType:0},shaderSource:l}},DP=(r,e,n,t,o,i)=>{let[a,s]=r.calculateTextureWidthAndHeight(e.dims,0),u=i.length;if(n<1||t<1)throw new Error("Logical row count N and feature count D must be greater than or equal to 1");if(i.length!==1)throw new Error("Dimensionality of the output should be 1");if(i[0]!==n)throw new Error("Shape of the output should be equal to logical row count");if(o.length!==1)throw new Error("Dimensionality of the intermediate results should be 1");if(o[0]!==n)throw new Error("Shape of the intermediate results should be equal to logical row count");let l=le(r.session.backend.glContext.version),d=`
      float process(int[${u}] indices) {
        int logical_row_start_offset = indices[0] * ${t};

        float norm_factor = 0.0;
        float max = _Max(indices);
        for(int i=0; i<${t}; ++i)
        {
          norm_factor += exp(getColorAsFloat(${l.texture2D}(A, offsetToCoords(logical_row_start_offset + i,
            ${a}, ${s}))) - max);
        }

        return norm_factor;
      }`;return{...Yb,output:{dims:i,type:e.type,textureType:0},shaderSource:d}},kP=(r,e,n,t,o,i)=>{let[a,s]=r.calculateTextureWidthAndHeight(e.dims,0),u=e.dims.length;if(n<1||t<1)throw new Error("Logical row count N and feature count D must be greater than or equal to 1");if(o.length!==1||i.length!==1)throw new Error("Dimensionality of the intermediate results should be 1");if(o[0]!==n||i[0]!==n)throw new Error("Shape of the intermediate results should be equal to logical row count");let l=`
      float process(int[${u}] indices) {

      // get offset of current logical tensor index from the 2-D texture coordinates (TexCoords)
      int offset = coordsToOffset(TexCoords, ${a}, ${s});

      //determine the logical row for this index
      int logical_row_index[1];
      logical_row_index[0] = offset / ${t};

      float norm_factor = _Norm(logical_row_index);

      // avoid possible division by 0
      // if norm_facor is 0, all elements are zero
      // if so, return 0
      if(norm_factor == 0.0)
        return 0.0;

      return exp(_A(indices) - _Max(logical_row_index)) / norm_factor;
    }`;return{...Qb,output:{dims:e.dims,type:e.type,textureType:0},shaderSource:l}},iy=r=>{if(!r||r.length!==1)throw new Error("Softmax requires 1 input.");if(r[0].type!=="float32"&&r[0].type!=="float64")throw new Error("Invalid input type")}});var sy,uy,ly,NP,LP,RP,cy=L(()=>{"use strict";pt();Be();Pe();sy={name:"Split",inputNames:["A"],inputTypes:[0]},uy=(r,e,n)=>{RP(e);let t=ae.normalizeAxis(n.axis,e[0].dims.length),o=NP(r,e,t,n),i=[];for(let a=0;a<o;++a)i.push(r.run({...sy,cacheHint:`${n.cacheKey};${a}`,get:()=>LP(r,e[0],n,t,a)},e));return i},ly=r=>{let e=r.attributes.getInt("axis",0),n=r.attributes.getInts("split",[]),t=r.outputs.length;return xe({axis:e,split:n,numOutputs:t})},NP=(r,e,n,t)=>{let[,o]=Co.splitShape(e[0].dims,n,t.split,t.numOutputs);return o.length},LP=(r,e,n,t,o)=>{let[i,a]=Co.splitShape(e.dims,t,n.split,n.numOutputs),s=a[o],u=i[o],d=`
      float process(int indices[${u.length}]) {
        indices[${t}] += ${s};
        return _A(indices);
      }
    `;return{...sy,cacheHint:`${n.cacheKey}:${o}`,output:{dims:u,type:e.type,textureType:0},shaderSource:d}},RP=r=>{if(!r||r.length!==1)throw new Error("Split requires one input.");if(r[0].type!=="int8"&&r[0].type!=="uint8"&&r[0].type!=="int16"&&r[0].type!=="uint16"&&r[0].type!=="int32"&&r[0].type!=="uint32"&&r[0].type!=="float32"&&r[0].type!=="float64"&&r[0].type!=="bool")throw new Error("Invalid input type.")}});var Jl,dy,py,zP,MP,fy=L(()=>{"use strict";Be();Jl=(r,e,n)=>{zP(e);let t=ae.squeezeShape(e[0].dims,n);return[r.reshapeUnpacked(e[0],t)]},dy=(r,e)=>(MP(e),Jl(r,[e[0]],Array.from(e[1].integerData))),py=r=>r.attributes.getInts("axes"),zP=r=>{if(!r||r.length!==1)throw new Error("Squeeze requires 1 input.");if(r[0].type==="string")throw new Error("invalid input tensor types.")},MP=r=>{if(!r||r.length!==2)throw new Error("Squeeze requires 2 inputs.");if(r[1].type!=="int32")throw new Error("Invalid input type.")}});var hy,BP,VP,my=L(()=>{"use strict";Qe();Pe();hy=(r,e)=>{VP(e);let n={name:"Sum",inputNames:e.map((o,i)=>`X${i}`),inputTypes:new Array(e.length).fill(0)};return[r.run({...n,get:()=>BP(r,e,n)},e)]},BP=(r,e,n)=>{let t=le(r.session.backend.glContext.version),o=e[0].dims.slice(),a=`
      void main() {
        vec4 result = ${e.map((s,u)=>`${t.texture2D}(X${u},TexCoords)`).join(" + ")};
        ${t.output} = result;
      }
    `;return{...n,output:{dims:o,type:e[0].type,textureType:0},hasMain:!0,shaderSource:a}},VP=r=>{if(!r||r.length===0)throw new Error("Sum requires inputs.");let e=r[0].dims.length;for(let n=1;n<r.length;n++){if(e!==r[n].dims.length)throw new Error("Input shapes are mismatched.");for(let t=0;t<e;t++)if(r[0].dims[t]!==r[n].dims[t])throw new Error("Input shapes are not matched.")}if(r[0].type!=="float32"&&r[0].type!=="float64")throw new Error("Invalid input type.");for(let n=1;n<r.length;n++)if(r[0].type!==r[n].type)throw new Error("Input types are not matched.")}});var gy,GP,UP,by=L(()=>{"use strict";zo();Pe();gy=(r,e)=>{UP(e);let n={name:"Tile",inputNames:["A"],inputTypes:[0]};return[r.run({...n,get:()=>GP(r,e,n)},e)]},GP=(r,e,n)=>{let t=e[0].dims.slice(),o=new Array(t.length),i=[];for(let u=0;u<t.length;u++)o[u]=t[u]*e[1].numberData[u],i.push(`inputIdx[${u}] = int(mod(float(outputIdx[${u}]), ${t[u]}.));`);let a=o.length,s=`
      float process(int outputIdx[${a}]) {
        int inputIdx[${a}];
        ${i.join(`
`)}
        return _A(inputIdx);
      }
    `;return{...n,output:{dims:o,type:e[0].type,textureType:0},shaderSource:s}},UP=r=>{if(!r||r.length!==2)throw new Error("Tile requires 2 input.");if(r[1].dims.length!==1)throw new Error("The second input shape must 1 dimension.");if(r[1].dims[0]!==r[0].dims.length)throw new Error("Invalid input shape.");if(hr.indexOf(r[0].type)===-1)throw new Error("Invalid input type.");if(r[1].type!=="int32"&&r[1].type!=="int16")throw new Error("Invalid repeat type.")}});var Yl,yy,_y,FP,WP,wy=L(()=>{"use strict";Be();Yl=(r,e,n)=>{FP(e);let t=ae.unsqueezeShape(e[0].dims,n);return[r.reshapeUnpacked(e[0],t)]},yy=(r,e)=>(WP(e),Yl(r,[e[0]],Array.from(e[1].integerData))),_y=r=>r.attributes.getInts("axes"),FP=r=>{if(!r||r.length!==1)throw new Error("Unsqueeze requires 1 input.");if(r[0].type==="string")throw new Error("invalid input tensor types.")},WP=r=>{if(!r||r.length!==2)throw new Error("Unsqueeze requires 2 inputs.");if(r[1].type!=="int32")throw new Error("Invalid input type.")}});var vy,xy=L(()=>{"use strict";Dm();Hm();Km();eg();Xi();zg();Fg();qg();Xg();Qg();nb();ab();cb();Zi();hb();Ab();Lb();zb();Fb();Hb();Zb();ay();cy();fy();my();by();Yi();Ll();wy();jl();vy=[["Abs","","6+",tg],["Acos","","7+",ng],["Add","","7+",km],["And","","7+",Nm],["Asin","","7+",rg],["Atan","","7+",og],["AveragePool","","7+",gb,bb],["BatchNormalization","","7+",Em,Cm],["Cast","","6+",qm,jm],["Ceil","","6+",sg],["Clip","","6-10",kl,ig],["Clip","","11+",ag],["Concat","","4+",Jm,Qm],["Conv","","1+",Gl,Ul],["ConvTranspose","","1+",Lg,Rg],["Cos","","7+",ug],["Div","","7+",Lm],["Dropout","","7+",Nl],["DepthToSpace","","1+",Gg,Ug],["Equal","","7+",Rm],["Elu","","6+",lg,cg],["Exp","","6+",dg],["Flatten","","1+",Wg,Hg],["Floor","","6+",pg],["FusedConv","com.microsoft","1+",Gl,Ul],["Gather","","1+",jg,Kg],["Gemm","","7-10",Fl,Jg],["Gemm","","11+",Fl,Yg],["GlobalAveragePool","","1+",_b,wb],["GlobalMaxPool","","1+",Sb],["Greater","","7+",zm],["Identity","","1+",Nl],["ImageScaler","","1+",eb,tb],["InstanceNormalization","","6+",ob,ib],["LeakyRelu","","6+",fg,hg],["Less","","7+",Mm],["LRN","","1+",sb,ub],["Log","","6+",mg],["MatMul","","1+",Og,Pg],["MaxPool","","1+",vb,xb],["Mul","","7+",Bm],["Neg","","6+",gg],["Not","","1+",bg],["Or","","7+",Vm],["Pad","","2-10",Wl,db],["Pad","","11+",pb,fb],["Pow","","7+",Gm],["PRelu","","7+",Um],["ReduceLogSum","","1+",kb,mr],["ReduceMax","","1+",Eb,mr],["ReduceMean","","1+",Pb,mr],["ReduceMin","","1+",Cb,mr],["ReduceProd","","1+",Db,mr],["ReduceSum","","1-12",Ob,mr],["ReduceSumSquare","","1+",Nb,mr],["Relu","","6+",yg],["Reshape","","5+",Rb],["Resize","","10",Xl,Gb],["Resize","","11+",Xl,Ub],["Shape","","1+",Wb],["Sigmoid","","6+",_g],["Sin","","7+",wg],["Slice","","10+",Xb],["Slice","","1-9",qb,jb],["Softmax","","1-12",ey,ty],["Softmax","","13+",ry,ny],["Split","","2-12",uy,ly],["Sqrt","","6+",vg],["Squeeze","","1-12",Jl,py],["Squeeze","","13+",dy],["Sub","","7+",Fm],["Sum","","6+",hy],["Tan","","7+",xg],["Tanh","","6+",Tg],["Tile","","6+",gy],["Transpose","","1+",zr,Bg],["Upsample","","7-8",Hl,Bb],["Upsample","","9",Hl,Vb],["Unsqueeze","","1-12",Yl,_y],["Unsqueeze","","13+",yy],["Xor","","7+",Wm]]});function Iy(r){let e={},n;for(;(n=Ty.exec(r))!==null;){let t=n[3].split(",").map(o=>{let i=o.trim().split(" ");return i&&i.length===2?{type:i[0],name:i[1]}:null}).filter(o=>o!==null);e[n[2]]={params:t,body:n[4]}}for(let t in e){let o=HP.replace("__FUNC__",t),i=new RegExp(o,"gm");for(;(n=i.exec(r))!==null;){let a=n[1],s=n[2],u=n[3].split(","),l=a?`${a} ${s};`:"",d=e[t].body,p="";e[t].params.forEach((g,b)=>{g&&(p+=`${g.type} ${g.name} = ${u[b]};
`)}),d=`${p}
 ${d}`,d=d.replace("return",`${s} = `);let h=`
      ${l}
      {
        ${d}
      }
      `;r=r.replace(n[0],h)}}return r=r.replace(Ty,""),r}var Ty,HP,Sy=L(()=>{"use strict";Ty=/@inline[\s\n\r]+(\w+)[\s\n\r]+([0-9a-zA-Z_]+)\s*\(([^)]*)\)\s*{(([^}]|[\n\r])*)}/gm,HP="(\\w+)?\\s+([_0-9a-zA-Z]+)\\s+=\\s+__FUNC__\\((.*)\\)\\s*;"});function ao(r,e){let n=[],t=[],o=e!=null&&Array.isArray(e)&&e.length===0,i=e==null||o?null:qP(e,r).sort(),a=0;for(let s=0;s<r.length;++s){if(i!=null){if(i[a]===s&&r[s]!==1)throw new Error(`Can't squeeze axis ${s} since its dim '${r[s]}' is not 1`);(i[a]==null||i[a]>s)&&r[s]===1&&(n.push(r[s]),t.push(s)),i[a]<=s&&a++}r[s]!==1&&(n.push(r[s]),t.push(s))}return{newShape:n,keptDims:t}}function qP(r,e){let n=e.length;return r=r==null?e.map((t,o)=>o):[].concat(r),eo(r.every(t=>t>=-n&&t<n),()=>`All values in axis param must be in range [-${n}, ${n}) but got axis ${r}`),eo(r.every(jP),()=>`All values in axis param must be integers but got axis ${r}`),r.map(t=>t<0?n+t:t)}function jP(r){return r%1===0}function KP(r){if(r.length===0)return 1;let e=r[0];for(let n=1;n<r.length;n++)e*=r[n];return e}function $y(r){let e=Math.ceil(Math.sqrt(r));return[e,Math.ceil(r/e)]}var na,Ql=L(()=>{"use strict";Dt();Be();na=class{constructor(e){this.maxTextureSize=e}computeTextureWH(e,n){let t=this.computeTexture(e,n);return n&&n.isPacked&&(t[0]/=2,t[1]/=2),n&&n.reverseWH?[t[1],t[0]]:t}computeTexture(e,n){let t=n&&n.isPacked;if(e.length===0)return t?[2,2]:[1,1];let o=this.maxTextureSize;if(n&&n.breakAxis!==void 0){let s=n.breakAxis>=e.length?1:e.slice(n.breakAxis).reduce((l,d)=>l*d),u=n.breakAxis<=0?1:e.slice(0,n.breakAxis).reduce((l,d)=>l*d);if(s>o||u>o)Ge.verbose("TextureLayout",`Given width/height preferences were unattainable: shape:${e}, breakAxis:${n.breakAxis}`);else return[s,u]}let i=e.slice(0);t&&(o=o*2,i=i.map((s,u)=>u>=i.length-2?i[u]%2===0?i[u]:i[u]+1:i[u]),i.length===1&&(i=[2,i[0]])),i.length!==2&&(i=ao(i).newShape);let a=KP(i);return i.length<=1&&a<=o?[1,a]:i.length===2&&i[0]<=o&&i[1]<=o?i:i.length===3&&i[0]*i[1]<=o&&i[2]<=o?[i[0]*i[1],i[2]]:i.length===3&&i[0]<=o&&i[1]*i[2]<=o?[i[0],i[1]*i[2]]:i.length===4&&i[0]*i[1]*i[2]<=o&&i[3]<=o?[i[0]*i[1]*i[2],i[3]]:i.length===4&&i[0]<=o&&i[1]*i[2]*i[3]<=o?[i[0],i[1]*i[2]*i[3]]:t?$y(a/4).map(s=>s*2):$y(a)}}});var ra,Ay=L(()=>{"use strict";Be();Yn();Qe();Ql();zn();ra=class extends Vt{constructor(e){super(e)}getFunctions(){return{...this.offsetToCoords(),...this.coordsToOffset(),...this.toVec(),...this.valueFrom(),...this.getCommonUtilFuncs(),...this.getInputsSamplingSnippets(),...this.getOutputSamplingSnippet()}}getCustomTypes(){return{}}offsetToCoords(){let e="offsetToCoords";return{offsetToCoords:new ee(`
      vec2 ${e}(int offset, int width, int height) {
        int t = offset / width;
        int s = offset - t*width;
        vec2 coords = (vec2(s,t) + vec2(0.5,0.5)) / vec2(width, height);
        return coords;
      }
      `)}}coordsToOffset(){let e="coordsToOffset";return{coordsToOffset:new ee(`
      int ${e}(vec2 coords, int width, int height) {
        float s = coords.s * float(width);
        float t = coords.t * float(height);
        int offset = int(t) * width + int(s);
        return offset;
      }
      `)}}getOutputSamplingSnippet(){let e=this.context.outputTextureLayout;return e.isPacked?this.getPackedOutputSamplingSnippet(e):this.getUnpackedOutputSamplingSnippet(e)}getPackedOutputSamplingSnippet(e){let n=e.unpackedShape,t=[e.width,e.height],o={},i="getOutputCoords";switch(n.length){case 0:o[i]=this.getOutputScalarCoords();break;case 1:o[i]=this.getOutputPacked1DCoords(n,t);break;case 2:o[i]=this.getOutputPacked2DCoords(n,t);break;case 3:o[i]=this.getOutputPacked3DCoords(n,t);break;default:o[i]=this.getOutputPackedNDCoords(n,t)}let s=`
      void setOutput(vec4 val) {
        ${le(this.context.glContext.version).output} = val;
      }
    `,u="floatTextureSetRGBA";return o[u]=new ee(s),o}getUnpackedOutputSamplingSnippet(e){let n=e.unpackedShape,t=[e.width,e.height],o={},i="getOutputCoords";switch(n.length){case 0:o[i]=this.getOutputScalarCoords();break;case 1:o[i]=this.getOutputUnpacked1DCoords(n,t);break;case 2:o[i]=this.getOutputUnpacked2DCoords(n,t);break;case 3:o[i]=this.getOutputUnpacked3DCoords(n,t);break;case 4:o[i]=this.getOutputUnpacked4DCoords(n,t);break;case 5:o[i]=this.getOutputUnpacked5DCoords(n,t);break;case 6:o[i]=this.getOutputUnpacked6DCoords(n,t);break;default:throw new Error(`Unsupported output dimensionality: ${n.length}`)}let s=`
        void setOutput(float val) {
          ${le(this.context.glContext.version).output} = vec4(val, 0, 0, 0);
        }
    `,u="floatTextureSetR";return o[u]=new ee(s),o}getOutputScalarCoords(){return new ee(`
      int getOutputCoords() {
        return 0;
      }
    `)}getOutputPacked1DCoords(e,n){let t=n,o="";return t[0]===1?(o=`
          int getOutputCoords() {
            return 2 * int(TexCoords.y * ${t[1]}.0);
          }
        `,new ee(o)):t[1]===1?(o=`
          int getOutputCoords() {
            return 2 * int(TexCoords.x * ${t[0]}.0);
          }
        `,new ee(o)):(o=`
        int getOutputCoords() {
          ivec2 resTexRC = ivec2(TexCoords.xy *
                                 vec2(${t[0]}, ${t[1]}));
          return 2 * (resTexRC.y * ${t[0]} + resTexRC.x);
        }
      `,new ee(o))}getOutputPacked2DCoords(e,n){let t="";if(Er.arraysEqual(e,n))return t=`
        ivec2 getOutputCoords() {
          return 2 * ivec2(TexCoords.xy * vec2(${n[0]}, ${n[1]}));
        }
      `,new ee(t);let o=n,i=Math.ceil(e[1]/2);return t=`
        ivec2 getOutputCoords() {
          ivec2 resTexRC = ivec2(TexCoords.xy *
                                vec2(${o[0]}, ${o[1]}));

          int index = resTexRC.y * ${o[0]} + resTexRC.x;

          // reverse r and c order for packed texture
          int r = imod(index, ${i}) * 2;
          int c = 2 * (index / ${i});

          return ivec2(r, c);
        }
      `,new ee(t)}getOutputPacked3DCoords(e,n){let t=[n[0],n[1]],o=Math.ceil(e[2]/2),i=o*Math.ceil(e[1]/2),a=`
        ivec3 getOutputCoords() {
          ivec2 resTexRC = ivec2(TexCoords.xy *
                                vec2(${t[0]}, ${t[1]}));
          int index = resTexRC.y * ${t[0]} + resTexRC.x;

          int b = index / ${i};
          index -= b * ${i};

          // reverse r and c order for packed texture
          int r = imod(index, ${o}) * 2;
          int c = 2 * (index / ${o});

          return ivec3(b, r, c);
        }
      `;return new ee(a)}getOutputPackedNDCoords(e,n){let t=[n[0],n[1]],o=Math.ceil(e[e.length-1]/2),i=o*Math.ceil(e[e.length-2]/2),a=i,s="",u="b, r, c";for(let d=2;d<e.length-1;d++)a*=e[e.length-d-1],s=`
      int b${d} = index / ${a};
      index -= b${d} * ${a};
    `+s,u=`b${d}, `+u;let l=`
      ivec${e.length} getOutputCoords() {
        ivec2 resTexRC = ivec2(TexCoords.xy *
                              vec2(${t[0]}, ${t[1]}));
        int index = resTexRC.y * ${t[0]} + resTexRC.x;

        ${s}

        int b = index / ${i};
        index -= b * ${i};

        // reverse r and c order for packed texture
        int r = imod(index, ${o}) * 2;
        int c = 2 * (index / ${o});

        return ivec${e.length}(${u});
      }
    `;return new ee(l)}getOutputUnpacked1DCoords(e,n){let t=`
        int getOutputCoords() {
          ivec2 resTexRC = ivec2(TexCoords.xy *
                                vec2(${n[0]}, ${n[1]}));
          return resTexRC.y * ${n[0]} + resTexRC.x;
        }
      `;return new ee(t)}getOutputUnpacked2DCoords(e,n){let t=`
        ivec2 getOutputCoords() {
          ivec2 resTexRC = ivec2(TexCoords.xy *
                                vec2(${n[0]}, ${n[1]}));
          int index = resTexRC.y * ${n[0]} + resTexRC.x;
          int r = index / ${e[1]};
          int c = index - r * ${e[1]};
          return ivec2(r, c);
        }
      `;return new ee(t)}getOutputUnpacked3DCoords(e,n){let t="",o=e.length,i=null;o<2&&(i=[]),i=new Array(o-1),i[o-2]=e[o-1];for(let u=o-3;u>=0;--u)i[u]=i[u+1]*e[u+1];let a=["r","c","d"],s=i.map((u,l)=>{let d=`int ${a[l]} = index / ${u}`,p=l===i.length-1?`int ${a[l+1]} = index - ${a[l]} * ${u}`:`index -= ${a[l]} * ${u}`;return`${d}; ${p};`}).join("");return t=`
        ivec3 getOutputCoords() {
          ivec2 resTexRC = ivec2(TexCoords.xy *
                                vec2(${n[0]}, ${n[1]}));
          int index = resTexRC.y * ${n[0]} + resTexRC.x;
          ${s}
          return ivec3(r, c, d);
        }
      `,new ee(t)}getOutputUnpacked4DCoords(e,n){let t="",o=e.length,i=null;o<2&&(i=[]),i=new Array(o-1),i[o-2]=e[o-1];for(let u=o-3;u>=0;--u)i[u]=i[u+1]*e[u+1];let a=["r","c","d","d2"],s=i.map((u,l)=>{let d=`int ${a[l]} = index / ${u}`,p=l===i.length-1?`int ${a[l+1]} = index - ${a[l]} * ${u}`:`index -= ${a[l]} * ${u}`;return`${d}; ${p};`}).join("");return t=`
      ivec4 getOutputCoords() {
          ivec2 resTexRC = ivec2(TexCoords.xy *
                                vec2(${n[0]}, ${n[1]}));
          int index = resTexRC.y * ${n[0]} + resTexRC.x;
          ${s}
          return ivec4(r, c, d, d2);
        }
      `,new ee(t)}getOutputUnpacked5DCoords(e,n){let t="",o=e.length,i=null;o<2&&(i=[]),i=new Array(o-1),i[o-2]=e[o-1];for(let u=o-3;u>=0;--u)i[u]=i[u+1]*e[u+1];let a=["r","c","d","d2","d3"],s=i.map((u,l)=>{let d=`int ${a[l]} = index / ${u}`,p=l===i.length-1?`int ${a[l+1]} = index - ${a[l]} * ${u}`:`index -= ${a[l]} * ${u}`;return`${d}; ${p};`}).join("");return t=`
      ivec5 getOutputCoords() {
          ivec2 resTexRC = ivec2(TexCoords.xy *
                                vec2(${n[0]}, ${n[1]}));
          int index = resTexRC.y * ${n[0]} + resTexRC.x;
          ${s}
          return ivec5(r, c, d, d2, d3);
        }
      `,new ee(t)}getOutputUnpacked6DCoords(e,n){let t="",o=e.length,i=null;o<2&&(i=[]),i=new Array(o-1),i[o-2]=e[o-1];for(let u=o-3;u>=0;--u)i[u]=i[u+1]*e[u+1];let a=["r","c","d","d2","d3","d4"],s=i.map((u,l)=>{let d=`int ${a[l]} = index / ${u}`,p=l===i.length-1?`int ${a[l+1]} = index - ${a[l]} * ${u}`:`index -= ${a[l]} * ${u}`;return`${d}; ${p};`}).join("");return t=`
     ivec6 getOutputCoords() {
         ivec2 resTexRC = ivec2(TexCoords.xy *
                               vec2(${n[0]}, ${n[1]}));
         int index = resTexRC.y * ${n[0]} + resTexRC.x;
         ${s}
         return ivec6(r, c, d, d2, d3, d4);
       }
     `,new ee(t)}getCommonUtilFuncs(){let e={},n="uvFromFlat";e[n]=new ee(`
    vec2 uvFromFlat(int texNumR, int texNumC, int index) {
      int texC = index / texNumR;
      int texR = index - texC * texNumR;
      // TODO: swap texR, texC order in following function so row is corresponding to u and column is corresponding to
      //       v.
      return (vec2(texR, texC) + halfCR) / vec2(texNumR, texNumC);
    }
    `),n="packedUVfrom1D",e[n]=new ee(`
      vec2 packedUVfrom1D(int texNumR, int texNumC, int index) {
        int texelIndex = index / 2;
        int texR = texelIndex / texNumC;
        int texC = texelIndex - texR * texNumC;
        return (vec2(texC, texR) + halfCR) / vec2(texNumC, texNumR);
      }
      `),n="packedUVfrom2D",e[n]=new ee(`
      vec2 packedUVfrom2D(int texNumR, int texNumC, int texelsInLogicalRow, int row, int col) {
        int texelIndex = (row / 2) * texelsInLogicalRow + (col / 2);
        int texR = texelIndex / texNumC;
        int texC = texelIndex - texR * texNumC;
        return (vec2(texC, texR) + halfCR) / vec2(texNumC, texNumR);
      }
      `),n="packedUVfrom3D",e[n]=new ee(`
      vec2 packedUVfrom3D(int texNumR, int texNumC,
          int texelsInBatch, int texelsInLogicalRow, int b,
          int row, int col) {
        int index = b * texelsInBatch + (row / 2) * texelsInLogicalRow + (col / 2);
        int texR = index / texNumC;
        int texC = index - texR * texNumC;
        return (vec2(texC, texR) + halfCR) / vec2(texNumC, texNumR);
      }
      `),n="sampleTexture";let t=le(this.context.glContext.version);return e[n]=new ee(`
        float sampleTexture(sampler2D textureSampler, vec2 uv) {
            return ${t.texture2D}(textureSampler, uv).r;
        }`),e}getInputsSamplingSnippets(){let e={},n=this.context.outputTextureLayout;return this.context.programInfo.inputNames.forEach((t,o)=>{let i=this.context.inputTextureLayouts[o],a=Ui(t);i.isPacked?e[a]=this.getPackedSamplerFromInput(a,t,i):e[a]=this.getUnpackedSamplerFromInput(a,t,i);let s=hm(t);i.unpackedShape.length<=n.unpackedShape.length&&(i.isPacked?e[s]=this.getPackedSamplerAtOutputCoords(s,i,n,t):e[s]=this.getUnpackedSamplerAtOutputCoords(s,i,n,t))}),e}getPackedSamplerAtOutputCoords(e,n,t,o){let i=n.unpackedShape,a=t.unpackedShape,u=Ui(o),l=i.length,d=a.length,p=bt.getBroadcastDims(i,a),h=yt(d),g=d-l,b,_=Xt();l===0?b="":d<2&&p.length>=1?b="coords = 0;":b=p.map(T=>`coords.${_[T+g]} = 0;`).join(`
`);let S="";d<2&&l>0?S="coords":S=i.map((T,F)=>`coords.${_[F+g]}`).join(", ");let v="return outputValue;",$=ae.size(i)===1,E=ae.size(a)===1;if(l===1&&!$&&!E)v=`
        return vec4(outputValue.xy, outputValue.xy);
      `;else if($&&!E)d===1?v=`
          return vec4(outputValue.x, outputValue.x, 0., 0.);
        `:v=`
          return vec4(outputValue.x);
        `;else if(p.length){let T=l-2,F=l-1;p.indexOf(T)>-1&&p.indexOf(F)>-1?v="return vec4(outputValue.x);":p.indexOf(T)>-1?v="return vec4(outputValue.x, outputValue.y, outputValue.x, outputValue.y);":p.indexOf(F)>-1&&(v="return vec4(outputValue.xx, outputValue.zz);")}let D=`
        int lastDim = coords.${_[d-1]};
        coords.${_[d-1]} = coords.${_[d-2]};
        coords.${_[d-2]} = lastDim;
      `,B=`
      vec4 ${e}() {
        ${h} coords = getOutputCoords();
        ${D}
        ${b}
        vec4 outputValue = ${u}(${S});
        ${v}
      }
    `;return new ee(B,["coordinates.getOutputCoords"])}getUnpackedSamplerAtOutputCoords(e,n,t,o){let i=[t.width,t.height],a=[n.width,n.height],s=n.unpackedShape.length,u=t.unpackedShape.length,l=n.unpackedShape,d=t.unpackedShape,p=Ui(o);if(s===u&&Er.arraysEqual(a,i)){let $=`
          float ${e}() {
            return sampleTexture(${o}, TexCoords);
          }
        `;return new ee($,["coordinates.sampleTexture"])}let h=yt(u),g=bt.getBroadcastDims(l,d),b=u-s,_,S=Xt();s===0?_="":u<2&&g.length>=1?_="coords = 0;":_=g.map($=>`coords.${S[$+b]} = 0;`).join(`
`);let v="";u<2&&s>0?v="coords":v=n.unpackedShape.map(($,O)=>`coords.${S[O+b]}`).join(", ");let x=`
        float ${e}() {
          ${h} coords = getOutputCoords();
          ${_}
          return ${p}(${v});
        }
      `;return new ee(x,["coordinates.getOutputCoords"])}getPackedSamplerFromInput(e,n,t){switch(t.unpackedShape.length){case 0:return this.getPackedSamplerScalar(e,n);case 1:return this.getPackedSampler1D(e,n,t);case 2:return this.getPackedSampler2D(e,n,t);case 3:return this.getPackedSampler3D(e,n,t);default:return this.getPackedSamplerND(e,n,t)}}getUnpackedSamplerFromInput(e,n,t){let o=t.unpackedShape;switch(o.length){case 0:return this.getUnpackedSamplerScalar(e,n,t);case 1:return this.getUnpackedSampler1D(e,n,t);case 2:return this.getUnpackedSampler2D(e,n,t);case 3:return this.getUnpackedSampler3D(e,n,t);case 4:return this.getUnpackedSampler4D(e,n,t);case 5:return this.getUnpackedSampler5D(e,n,t);case 6:return this.getUnpackedSampler6D(e,n,t);default:throw new Error(`Unsupported dimension ${o.length}-D`)}}getPackedSamplerScalar(e,n){let t=le(this.context.glContext.version),o=`
          vec4 ${e}() {
            return ${t.texture2D}(${n}, halfCR);
          }
        `;return new ee(o)}getPackedSampler1D(e,n,t){let o=[t.width,t.height],i=[o[1],o[0]],a=le(this.context.glContext.version),u=`vec4 ${e}(int index) {
      vec2 uv = packedUVfrom1D(
      ${i[0]}, ${i[1]}, index);
      return ${a.texture2D}(${n}, uv);
    }`;return new ee(u,["coordinates.packedUVfrom1D"])}getPackedSampler2D(e,n,t){let o=t.unpackedShape,i=[t.width,t.height],a=le(this.context.glContext.version),s=i[0],u=i[1];if(i!=null&&Er.arraysEqual(o,i)){let g=`vec4 ${e}(int row, int col) {
        vec2 uv = (vec2(col, row) + halfCR) / vec2(${u}.0, ${s}.0);
        return ${a.texture2D}(${n}, uv);
      }`;return new ee(g)}let l=i,d=Math.ceil(o[1]/2),h=`vec4 ${e}(int row, int col) {
      vec2 uv = packedUVfrom2D(${l[1]}, ${l[0]}, ${d}, row, col);
      return ${a.texture2D}(${n}, uv);
    }`;return new ee(h,["coordinates.packedUVfrom2D"])}getPackedSampler3D(e,n,t){let o=t.unpackedShape,i=[t.width,t.height],a=[i[0],i[1]],s=le(this.context.glContext.version);if(o[0]===1){let b=o.slice(1),_=[1,2],S=to(o,b),v=["b","row","col"],x=JSON.parse(JSON.stringify(t));x.unpackedShape=S;let $=this.getPackedSamplerFromInput(e,n,x),E=`${$.routineBody}
      vec4 ${e}(int b, int row, int col) {
        return ${e}(${no(v,_)});
      } `;return new ee(E,$.dependencies)}let u=a[0],l=a[1],d=Math.ceil(o[2]/2),p=d*Math.ceil(o[1]/2),g=`vec4 ${e}(int b, int row, int col) {
      vec2 uv = packedUVfrom3D(
        ${l}, ${u}, ${p}, ${d}, b, row, col);
      return ${s.texture2D}(${n}, uv);}`;return new ee(g,["coordinates.packedUVfrom3D"])}getPackedSamplerND(e,n,t){let o=t.unpackedShape,i=o.length,a=[t.width,t.height],s=le(this.context.glContext.version),u=[a[0],a[1]],l=u[1],d=u[0],p=Math.ceil(o[i-1]/2),h=p*Math.ceil(o[i-2]/2),g="int b, int row, int col",b=`b * ${h} + (row / 2) * ${p} + (col / 2)`;for(let v=2;v<i-1;v++)g=`int b${v}, `+g,h*=o[i-v-1],b=`b${v} * ${h} + `+b;let S=`vec4 ${e}(${g}) {
      int index = ${b};
      int texR = index / ${d};
      int texC = index - texR * ${d};
      vec2 uv = (vec2(texC, texR) + halfCR) / vec2(${d}, ${l});
      return ${s.texture2D}(${n}, uv);
    }`;return new ee(S)}getUnpackedSamplerScalar(e,n,t){let[o,i]=[t.width,t.height];if(o===1&&i===1){let s=`
          float ${e}() {
            return sampleTexture(${n}, halfCR);
          }
        `;return new ee(s,["coordinates.sampleTexture"])}let a=`
        float ${e}() {
          int offset_${n} = coordsToOffset(TexCoords, ${o}, ${i});
          vec2 uv = uvFromFlat(${o}, ${i}, offset_${n});
          return sampleTexture(${n}, uv);
        }
      `;return new ee(a,["coordinates.uvFromFlat","coordinates.sampleTexture","coordinates.coordsToOffset"])}getUnpackedSampler1D(e,n,t){let o=t.width,i=t.height;if(i===1&&o===1){let s=`
        float ${e}(int index) {
          return sampleTexture(${n}, halfCR);
        }
      `;return new ee(s,["coordinates.sampleTexture"])}if(i===1){let s=`
          float ${e}(int index) {
            vec2 uv = vec2((float(index) + 0.5) / ${o}.0, 0.5);
            return sampleTexture(${n}, uv);
          }
        `;return new ee(s,["coordinates.sampleTexture"])}if(o===1){let s=`
          float ${e}(int index) {
            vec2 uv = vec2(0.5, (float(index) + 0.5) / ${i}.0);
            return sampleTexture(${n}, uv);
          }
        `;return new ee(s,["coordinates.sampleTexture"])}let a=`
        float ${e}(int index) {
          vec2 uv = uvFromFlat(${o}, ${i}, index);
          return sampleTexture(${n}, uv);
        }
      `;return new ee(a,["coordinates.uvFromFlat","coordinates.sampleTexture"])}getUnpackedSampler2D(e,n,t){let o=t.unpackedShape,i=[t.height,t.width];if(i!=null&&Er.arraysEqual(o,i)){let h=i[1],g=i[0],b=`
          float ${e}(int row, int col) {
            vec2 uv = (vec2(row, col) + halfCR) / vec2(${h}.0, ${g}.0);
            return sampleTexture(${n}, uv);
          }
        `;return new ee(b,["coordinates.sampleTexture"])}let{newShape:a,keptDims:s}=ao(o),u=a;if(u.length<o.length){let h=to(o,u),g=JSON.parse(JSON.stringify(t));g.unpackedShape=h;let b=["col","row"],_=`
          ${this.getUnpackedSamplerFromInput(e,n,g).routineBody}
          float ${e}(int row, int col) {
            return ${e}(${no(b,s)});
          }
        `;return new ee(_,["coordinates.sampleTexture"])}let l=i[1],d=i[0];if(d===1){let h=`
          float ${e}(int row, int col) {
            int offset_${n} = coordsToOffset(TexCoords, ${l}, ${d});
            float index = dot(vec3(row, col, offset_${n}), vec3(${o[1]}, 1, 1));
            vec2 uv = vec2(0.5, (index + 0.5) / ${l}.0);
            return sampleTexture(${n}, uv);
          }
        `;return new ee(h,["coordinates.sampleTexture","coordinates.coordsToOffset"])}if(l===1){let h=`
          float ${e}(int row, int col) {
            int offset_${n} = coordsToOffset(TexCoords, ${l}, ${d});
            float index = dot(vec3(row, col, offset_${n}), vec3(${o[1]}, 1, 1));
            vec2 uv = vec2((index + 0.5) / ${d}.0, 0.5);
            return sampleTexture(${n}, uv);
          }
        `;return new ee(h,["coordinates.sampleTexture","coordinates.coordsToOffset"])}let p=`
        float ${e}(int row, int col) {
          int index = col * ${o[1]} + row;
          vec2 uv = uvFromFlat(${l}, ${d}, index);
          return sampleTexture(${n}, uv);
        }
      `;return new ee(p,["coordinates.uvFromFlat","coordinates.sampleTexture","coordinates.coordsToOffset"])}getUnpackedSampler3D(e,n,t){let o=t.unpackedShape,i=o[1]*o[2],a=o[2],{newShape:s,keptDims:u}=ao(o),l=s;if(l.length<o.length){let g=to(o,l),b=["batch","col","row"],_=JSON.parse(JSON.stringify(t));_.unpackedShape=g;let S=this.getUnpackedSamplerFromInput(e,n,_),v=u.reverse(),x=`
          ${S.routineBody}
          float ${e}(int batch, int row, int col) {
            return ${e}(${no(b,v)});
          }
        `;return new ee(x,S.dependencies)}let d=t.width,p=t.height,h=`
          float ${e}(int depth, int row, int col) {
            // Explicitly use integer operations as dot() only works on floats.
            int index = depth * ${i} + col * ${a} + row;
            vec2 uv = uvFromFlat(${d}, ${p}, index);
            return sampleTexture(${n}, uv);
          }
      `;return new ee(h,["coordinates.uvFromFlat","coordinates.sampleTexture","coordinates.coordsToOffset"])}getUnpackedSampler4D(e,n,t){let o=t.unpackedShape,i=o[3],a=o[2]*i,s=o[1]*a,u=t.width,l=t.height,d=`
        float ${e}(int row, int col, int depth, int depth2) {
          int index = row * ${s} + col * ${a} +
              depth2 * ${i} + depth;
          vec2 uv = uvFromFlat(${u}, ${l}, index);
          return sampleTexture(${n}, uv);
        }
      `;return new ee(d,["coordinates.uvFromFlat","coordinates.sampleTexture"])}getUnpackedSampler5D(e,n,t){let o=t.unpackedShape,i=o[4],a=o[3]*i,s=o[2]*a,u=o[1]*s,{newShape:l,keptDims:d}=ao(o);if(l.length<o.length){let b=to(o,l),_=["row","col","depth","depth2","depth3"],S=JSON.parse(JSON.stringify(t));S.unpackedShape=b;let v=`
          ${this.getUnpackedSamplerFromInput(e,n,S).routineBody}
          float ${e}(int row, int col, int depth, int depth2, int depth3) {
            return ${e}(${no(_,d)});
          }
        `;return new ee(v,["coordinates.sampleTexture","coordinates.uvFromFlat"])}let p=t.width,h=t.height,g=`
        float ${e}(int row, int col, int depth, int depth2, int depth3) {
          int index = row * ${u} + col * ${s} + depth * ${a} +
          depth3 * ${i} + depth2;
          vec2 uv = uvFromFlat(${p}, ${h}, index);
          return sampleTexture(${n}, uv);
        }
      `;return new ee(g,["coordinates.sampleTexture","coordinates.uvFromFlat"])}getUnpackedSampler6D(e,n,t){let o=t.unpackedShape,i=o[5],a=o[4]*i,s=o[3]*a,u=o[2]*s,l=o[1]*u,{newShape:d,keptDims:p}=ao(o);if(d.length<o.length){let _=to(o,d),S=["row","col","depth","depth2","depth3","depth4"],v=JSON.parse(JSON.stringify(t));v.unpackedShape=_;let x=`
            ${this.getUnpackedSamplerFromInput(e,n,v).routineBody}
            float ${e}(int row, int col, int depth,
              int depth2, int depth3, int depth4) {
              return ${e}(${no(S,p)});
            }
          `;return new ee(x,["coordinates.sampleTexture","coordinates.uvFromFlat"])}let h=t.width,g=t.height,b=`
          float ${e}(int row, int col, int depth,
            int depth2, int depth3, int depth4) {
            int index = row * ${l} + col * ${u} + depth * ${s} +
            depth2 * ${a} + depth3 * ${i} + depth4;
            vec2 uv = uvFromFlat(${h}, ${g}, index);
            return sampleTexture(${n}, uv);
          }
        `;return new ee(b,["coordinates.uvFromFlat","coordinates.sampleTexture","coordinates.coordsToOffset"])}toVec(){let e=this.context.outputTextureLayout,n=e.shape.length,t=e.strides,o=e.width,i=e.height,a=[];for(let u=0;u<n-1;++u)a.push(`
        c[${u}] = offset / ${t[u]};`),a.push(`
        offset -= c[${u}] * ${t[u]};`);a.push(`
        c[${n-1}] = offset;`);let s=`
      void toVec(vec2 texCoords, out int c[${n}]) {
        int offset = coordsToOffset(texCoords, ${o}, ${i});
        ${a.join("")}
      }
      void toVec(int offset, out int c[${n}]) {
        ${a.join("")}
      }
    `;return{toVec:new ee(s,["coordinates.coordsToOffset"])}}valueFrom(){let e={};return this.context.programInfo.inputNames.forEach((n,t)=>{let o=this.context.inputTextureLayouts[t],a=(o.unpackedShape.length>0?o.unpackedShape:o.shape).length,s=`_${n}`;e[s]=new ee(this.getValueFromSingle(n,a,o.width,o.height,!1),[`shapeUtils.indicesToOffset${s}`,"coordinates.offsetToCoords","fragcolor.getColorAsFloat"]),s=s+"_T",e[s]=new ee(this.getValueFromSingle(n,a,o.width,o.height,!0),[`shapeUtils.indicesToOffset${s}`,"coordinates.offsetToCoords","fragcolor.getColorAsFloat"])}),e}getValueFromSingle(e,n,t,o,i){let a=`_${e}`;i&&(a=a+"_T");let s=le(this.context.glContext.version);return`
        float ${a}(int m[${n}]) {
          int offset = indicesToOffset${a}(m);
          vec2 coords = offsetToCoords(offset, ${t}, ${o});
          float value = getColorAsFloat(${s.texture2D}(${e}, coords));
          return value;
        }
        `}getPackedValueFrom(e,n,t,o,i){let a=`_${e}_Pack`;i&&(a=a+"_T");let s=le(this.context.glContext.version);return`
        vec4 ${a}(int m[${n}]) {
          int offset = indicesToOffset_${e}(m);
          vec2 coords = offsetToCoords(offset, ${t}, ${o});
          return ${s.texture2D}(${e}, coords);
        }
        `}}});var oa,Oy=L(()=>{"use strict";Yn();oa=class r extends Vt{constructor(e){super(e)}getFunctions(){return{...this.encodeFloat32(),...this.decodeFloat32()}}getCustomTypes(){return{}}encodeFloat32(){return{encode:new ee(`highp vec4 encode(highp float f) {
        return vec4(f, 0.0, 0.0, 0.0);
      }
        `)}}decodeFloat32(){return{decode:new ee(`highp float decode(highp vec4 rgba) {
        return rgba.r;
      }
        `)}}encodeUint8(){let e=r.isLittleEndian()?"rgba.rgba=rgba.abgr;":"";return{encode:new ee(`
      highp vec4 encode(highp float f) {
        highp float F = abs(f);
        highp float Sign = step(0.0,-f);
        highp float Exponent = floor(log2(F));
        highp float Mantissa = (exp2(- Exponent) * F);
        Exponent = floor(log2(F) + 127.0) + floor(log2(Mantissa));
        highp vec4 rgba;
        rgba[0] = 128.0 * Sign  + floor(Exponent*exp2(-1.0));
        rgba[1] = 128.0 * mod(Exponent,2.0) + mod(floor(Mantissa*128.0),128.0);
        rgba[2] = floor(mod(floor(Mantissa*exp2(23.0 -8.0)),exp2(8.0)));
        rgba[3] = floor(exp2(23.0)*mod(Mantissa,exp2(-15.0)));
        ${e}
        rgba = rgba / 255.0; // values need to be normalized to [0,1]
        return rgba;
    }
        `)}}decodeUint8(){let e=r.isLittleEndian()?"rgba.rgba=rgba.abgr;":"";return{decode:new ee(`
        highp float decode(highp vec4 rgba) {
          rgba = rgba * 255.0; // values need to be de-normalized from [0,1] to [0,255]
          ${e}
          highp float Sign = 1.0 - step(128.0,rgba[0])*2.0;
          highp float Exponent = 2.0 * mod(rgba[0],128.0) + step(128.0,rgba[1]) - 127.0;
          highp float Mantissa = mod(rgba[1],128.0)*65536.0 + rgba[2]*256.0 +rgba[3] + float(0x800000);
          highp float Result =  Sign * exp2(Exponent) * (Mantissa * exp2(-23.0 ));
          return Result;
      }
        `)}}static isLittleEndian(){let e=new ArrayBuffer(4),n=new Uint32Array(e),t=new Uint8Array(e);if(n[0]=3735928559,t[0]===239)return!0;if(t[0]===222)return!1;throw new Error("unknown endianness")}}});var ia,Py=L(()=>{"use strict";Yn();Qe();ia=class extends Vt{constructor(e){super(e)}getFunctions(){return{...this.setFragColor(),...this.getColorAsFloat()}}getCustomTypes(){return{}}setFragColor(){let e=le(this.context.glContext.version);return{setFragColor:new ee(`
        void setFragColor(float value) {
            ${e.output} = encode(value);
        }
        `,["encoding.encode"])}}getColorAsFloat(){return{getColorAsFloat:new ee(`
        float getColorAsFloat(vec4 color) {
            return decode(color);
        }
        `,["encoding.decode"])}}}});var aa,Ey=L(()=>{"use strict";Yn();aa=class r extends Vt{constructor(e){super(e)}getFunctions(){return{...this.bcastIndex(),...this.bcastMatmulIndex(),...this.offsetToIndices(),...this.indicesToOffset(),...this.incrementIndices()}}getCustomTypes(){return{}}bcastIndex(){let e=this.context.outputTextureLayout.shape.length,n={};return this.context.programInfo.inputNames.forEach((t,o)=>{let i=this.context.inputTextureLayouts[o].unpackedShape;if(i.length<=e){let a=i.length,s=e-a,u=`bcastIndices_${t}`,l="";for(let p=0;p<a;++p)l+=`
          realIndices[${p}] = int( mod(float(bcastedIndices[${s+p}]), ${i[p]}.0) );
          `;let d=`
        void ${u} (int bcastedIndices[${e}], out int realIndices[${a}]) {
          ${l}
        }
        `;n[u]=new ee(d)}}),n}bcastMatmulIndex(){let e=this.context.outputTextureLayout.shape.length,n={};return this.context.programInfo.inputNames.forEach((t,o)=>{let i=this.context.inputTextureLayouts[o].shape;if(!(i.length<2||i.length>e)){let a=i.length,s=e-a,u=`bcastMatmulIndices_${t}`,l="";for(let p=0;p<a-2;++p)l+=`
          realIndices[${p}] = int( mod(float(bcastedIndices[${s+p}]), ${i[p]}.0) );
          `;let d=`
        void ${u}(int bcastedIndices[${e}], out int realIndices[${a}]) {
          ${l}
          realIndices[${a-1}] = bcastedIndices[${e-1}];
          realIndices[${a-2}] = bcastedIndices[${e-2}];
        }
        `;n[u]=new ee(d)}}),n}indicesToOffset(){let e={};return this.context.programInfo.inputNames.forEach((n,t)=>{let o=this.context.inputTextureLayouts[t].shape,i=this.context.inputTextureLayouts[t].strides,a=o.length,s=`indicesToOffset_${n}`;e[s]=new ee(r.indexToOffsetSingle(s,a,i)),s=`indicesToOffset_${n}_T`,e[s]=new ee(r.indexToOffsetSingle(s,a,i.slice().reverse()))}),e}static indexToOffsetSingle(e,n,t){let o="";for(let i=n-1;i>=0;--i)o+=`
        offset += indices[${i}] * ${t[i]};
        `;return`
      int ${e}(int indices[${n}]) {
        int offset = 0;
        ${o}
        return offset;
      }
      `}offsetToIndices(){let e={};return this.context.programInfo.inputNames.forEach((n,t)=>{let o=this.context.inputTextureLayouts[t].shape,i=this.context.inputTextureLayouts[t].strides,a=o.length,s=`offsetToIndices_${n}`;e[s]=new ee(r.offsetToIndicesSingle(s,a,i)),s=`offsetToIndices_${n}_T`,e[s]=new ee(r.offsetToIndicesSingle(s,a,i.slice().reverse()))}),e}static offsetToIndicesSingle(e,n,t){let o=[];for(let i=0;i<n-1;++i)o.push(`
      indices[${i}] = offset / ${t[i]};`),o.push(`
        offset -= indices[${i}] * ${t[i]};`);return o.push(`
      indices[${n-1}] = offset;`),`
      void ${e}(int offset, out int indices[${n}]) {
        ${o.join("")}
      }
      `}incrementIndices(){let e={};return this.context.programInfo.inputNames.forEach((n,t)=>{let o=this.context.inputTextureLayouts[t].shape,i=o.length,a=`incrementIndices_${n}`,s="";for(let l=0;l<i;++l)s+=`
        shape[${l}] = ${o[l]};`;let u=`
        void ${a}(int axis, out int indices[${i}]) {
          int shape[${i}];
          ${s};
          for(int i = ${i} -1 ; i >= 0; --i) {
            if(i > axis) continue;
            indices[i] += 1;
            if(indices[i] < shape[i]) {
              break;
            }
            indices[i] = 0;
          }
        }
        `;e[a]=new ee(u)}),e}}});var sa,Cy=L(()=>{"use strict";Yn();sa=class extends Vt{constructor(e){super(e)}getCustomTypes(){return{}}getFunctions(){return{...this.binaryVecFunctions(),...this.copyVec(),...this.setVecItem(),...this.getVecItem()}}binaryVecFunctions(){let n=this.context.outputTextureLayout.shape.length,t={add:"+=",sub:"-=",mul:"*=",div:"/="},o={};for(let i in t){let a=`${i}Vec`,s="";for(let l=0;l<n;++l)s+=`
          dest[${l}] ${t[i]} src[${l}];
          `;let u=`
        void ${a}(int src[${n}], out int dest[${n}]) {
          ${s}
        }
        `;o[a]=new ee(u)}return o}copyVec(){let n=this.context.outputTextureLayout.shape.length,t="";for(let i=0;i<n;++i)t+=`
        dest[${i}] = src[${i}];
        `;let o=`
      void copyVec(int src[${n}], out int dest[${n}]) {
        ${t}
      }
      `;return{copyVec:new ee(o)}}setVecItem(){let n=this.context.outputTextureLayout.shape.length,t=`
        if(index < 0)
            index =${n} + index;
        if (index == 0)
            m[0] = value;
        `;for(let i=1;i<n-1;++i)t+=`
        else if (index == ${i})
            m[${i}] = value;
            `;t+=`
        else
            m[${n-1}] = value;
        `;let o=`
      void setVecItem(out int m[${n}], int index, int value) {
        ${t}
      }
        `;return{setVecItem:new ee(o)}}getVecItem(){let n=this.context.outputTextureLayout.shape.length,t=`
        if(index < 0)
            index = ${n} + index;
        if (index == 0)
            return m[0];
      `;for(let i=1;i<n-1;++i)t+=`
        else if (index == ${i})
            return m[${i}];
      `;t+=`
        else
            return m[${n-1}];
        `;let o=`
      int getVecItem(int m[${n}], int index) {
        ${t}
      }
    `;return{getVecItem:new ee(o)}}}});var ec,Dy=L(()=>{"use strict";Ay();Oy();Py();Ey();Cy();ec={encoding:oa,fragcolor:ia,vec:sa,shapeUtils:aa,coordinates:ra}});var ua,ky=L(()=>{"use strict";Yn();Sy();Dy();Qe();ua=class{constructor(e,n,t,o){this.libs={};this.glslLibRoutineDependencyGraph={};this.context=new qi(e,n,t,o),Object.keys(ec).forEach(a=>{let s=new ec[a](this.context);this.libs[a]=s});let i=this.glslLibRoutineDependencyGraph;for(let a in this.libs){let u=this.libs[a].getFunctions();for(let l in u){let d=a+"."+l,p;i[d]?(p=i[d],p.routineBody=u[l].routineBody):(p=new Ro(d,u[l].routineBody),i[d]=p);let h=u[l].dependencies;if(h)for(let g=0;g<h.length;++g)if(i[h[g]])p.addDependency(i[h[g]]);else{let b=new Ro(h[g]);i[h[g]]=b,p.addDependency(b)}}}}preprocess(){let e=this.context.programInfo,n=e.shaderSource;return this.context.programInfo.hasMain||(n=`${n}
      ${fm(this.context.glContext.version,this.context.outputTextureLayout.shape.length)}`),n=Iy(n),`${pm(this.context.glContext.version)}
    ${this.getUniforms(e.inputNames,e.variables)}
    ${this.getImports(n)}
    ${n}`}getImports(e){let n=this.selectGlslLibRoutinesToBeIncluded(e);if(n.length===0)return"";let t="";for(let o=0;o<n.length;++o)if(n[o].routineBody)t+=n[o].routineBody+`
`;else throw new Error(`Missing body for the Glsl Library routine: ${n[o].name}`);return t}selectGlslLibRoutinesToBeIncluded(e){let n=[];return Object.keys(this.glslLibRoutineDependencyGraph).forEach(t=>{let o=t.split(".")[1];e.indexOf(o)!==-1&&n.push(this.glslLibRoutineDependencyGraph[t])}),ji.returnOrderedNodes(n)}getUniforms(e,n){let t=[];if(e)for(let o of e)t.push(`uniform sampler2D ${o};`);if(n)for(let o of n)t.push(`uniform ${o.type} ${o.name}${o.arrayLength?`[${o.arrayLength}]`:""};`);return t.join(`
`)}}});var la,Ny=L(()=>{"use strict";ht();Dt();ky();Qe();la=class{constructor(e,n,t){this.profiler=e;this.glContext=n;this.textureLayoutStrategy=t;this.repo=new Map,this.attributesBound=!1}getArtifact(e){return this.repo.get(e)}setArtifact(e,n){this.repo.set(e,n)}run(e,n,t){this.profiler.event("op",`ProgramManager.run ${e.programInfo.name??"unknown kernel"}`,()=>{let o=this.glContext.gl,i=e.program;o.useProgram(i);try{this.bindOutput(t),this.attributesBound||this.bindAttributes(e.attribLocations),this.bindUniforms(e.uniformLocations,e.programInfo.variables??[],n)}catch(a){throw Ge.error("ProgramManager",e.programInfo.shaderSource),a}this.profiler.event("backend","GlContext.draw()",()=>{this.glContext.draw()})},this.glContext)}dispose(){this.vertexShader&&this.glContext.deleteShader(this.vertexShader),this.repo.forEach(e=>this.glContext.deleteProgram(e.program))}build(e,n,t){return this.profiler.event("backend","ProgramManager.build",()=>{let o=new ua(this.glContext,e,n,t),i=o.preprocess(),a=this.compile(i);return{programInfo:e,program:a,uniformLocations:this.getUniformLocations(a,o.context.programInfo.inputNames,o.context.programInfo.variables),attribLocations:this.getAttribLocations(a)}})}compile(e){if(!this.vertexShader){Ge.verbose("ProrgramManager","Compiling and caching Vertex shader for the first time");let o=dm(this.glContext.version);this.vertexShader=this.glContext.compileShader(o,this.glContext.gl.VERTEX_SHADER)}he.debug&&Ge.verbose("ProrgramManager",`FragShader:
${e}
`);let n=this.glContext.compileShader(e,this.glContext.gl.FRAGMENT_SHADER),t=this.glContext.createProgram(this.vertexShader,n);return this.glContext.deleteShader(n),t}bindOutput(e){let n=e.width,t=e.height;Ge.verbose("ProrgramManager",`Binding output texture to Framebuffer: w/h=${n}/${t}, shape=${e.shape}, type=${e.tensor.type}`),this.glContext.attachFramebuffer(e.texture,n,t)}bindAttributes(e){let n=e.position,t=e.textureCoord;this.glContext.setVertexAttributes(n,t),this.attributesBound=!0}bindUniforms(e,n,t){let o=this.glContext.gl,i=0;for(let{name:a,type:s,location:u,arrayLength:l}of e){let d=n.find(p=>p.name===a)?.data;if(s!=="sampler2D"&&!d)throw new Error(`variable '${a}' does not have data defined in program info`);switch(s){case"sampler2D":this.bindTexture(t[i],u,i),i++;break;case"float":l?o.uniform1fv(u,d):o.uniform1f(u,d);break;case"int":l?o.uniform1iv(u,d):o.uniform1i(u,d);break;default:throw new Error(`Uniform not implemented: ${s}`)}}}bindTexture(e,n,t){this.glContext.bindTextureToUniform(e.texture,t,n)}getAttribLocations(e){return{position:this.getAttribLocation(e,"position"),textureCoord:this.getAttribLocation(e,"textureCoord")}}getUniformLocations(e,n,t){let o=[];if(n)for(let i of n)o.push({name:i,type:"sampler2D",location:this.getUniformLocation(e,i)});if(t)for(let i of t)o.push({...i,location:this.getUniformLocation(e,i.name)});return o}getUniformLocation(e,n){let o=this.glContext.gl.getUniformLocation(e,n);if(o===null)throw new Error(`Uniform ${n} not found.`);return o}getAttribLocation(e,n){return this.glContext.gl.getAttribLocation(e,n)}}});var ca,Ly=L(()=>{"use strict";Dt();No();ca=class{constructor(e,n,t,o){this.glContext=e;this.layoutStrategy=n;this.profiler=t;this.config=o;this.pendingRead=new Map;o.reuseTextures&&(this.inUseTextures=new Map,this.idleTextures=new Map,this.textureLookup=new Map)}createTextureFromLayout(e,n,t,o){let i=this.toEncoderType(e),a=this.glContext.getEncoder(i,n.channels||1,o);if(n.isPacked&&o===1)throw new Error("not implemented");let s=n.width,u=n.height,l,d;if(this.config.reuseTextures){l=`${s}x${u}_${a.format}_${a.internalFormat}_${a.textureType}`,d=this.inUseTextures.get(l),d||(d=[],this.inUseTextures.set(l,d));let h=this.idleTextures.get(l);if(h&&h.length>0){let g=h.pop();return d.push(g),o===1&&this.glContext.updateTexture(g,s,u,a,this.toTextureData(e,t)),g}}Ge.verbose("TextureManager",`Creating new texture of size ${n.width}x${n.height}`);let p=this.glContext.allocateTexture(s,u,a,this.toTextureData(e,t));return this.config.reuseTextures&&(d.push(p),this.textureLookup.set(p,l)),p}readTexture(e,n,t){return t||(t=1),this.profiler.event("backend","TextureManager.readTexture",()=>{let o=e.shape.reduce((a,s)=>a*s)*t,i=this.glContext.readTexture(e.texture,e.width,e.height,o,this.toEncoderType(n),t);return this.toTensorData(n,i)})}async readTextureAsync(e,n,t){let o=e.tensor.dataId;if(t||(t=1),this.pendingRead.has(o)){let i=this.pendingRead.get(o);return new Promise(a=>i?.push(a))}return this.profiler.event("backend","TextureManager.readTextureAsync",async()=>{this.pendingRead.set(o,[]);let i=e.shape.reduce((l,d)=>l*d)*t;await this.glContext.createAndWaitForFence();let a=this.glContext.readTexture(e.texture,e.width,e.height,i,this.toEncoderType(n),t),s=this.toTensorData(n,a),u=this.pendingRead.get(o);return this.pendingRead.delete(o),u?.forEach(l=>l(s)),s})}readUint8TextureAsFloat(e){return this.profiler.event("backend","TextureManager.readUint8TextureAsFloat",()=>{let n=e.shape.reduce((o,i)=>o*i),t=this.glContext.readTexture(e.texture,e.width,e.height,n*4,"byte",4);return new Float32Array(t.buffer,t.byteOffset,n)})}releaseTexture(e,n){let t;if(this.config.reuseTextures&&(t=this.textureLookup.get(e.texture),t)){n&&this.textureLookup.delete(t);let o=this.inUseTextures.get(t);if(o){let i=o.indexOf(e.texture);if(i!==-1){o.splice(i,1);let a=this.idleTextures.get(t);a||(a=[],this.idleTextures.set(t,a)),a.push(e.texture)}}}(!t||n)&&(Ge.verbose("TextureManager",`Deleting texture of size ${e.width}x${e.height}`),this.glContext.deleteTexture(e.texture))}toTensorData(e,n){switch(e){case"int16":return n instanceof Int16Array?n:Int16Array.from(n);case"int32":return n instanceof Int32Array?n:Int32Array.from(n);case"int8":return n instanceof Int8Array?n:Int8Array.from(n);case"uint16":return n instanceof Uint16Array?n:Uint16Array.from(n);case"uint32":return n instanceof Uint32Array?n:Uint32Array.from(n);case"uint8":case"bool":return n instanceof Uint8Array?n:Uint8Array.from(n);case"float32":return n instanceof Float32Array?n:Float32Array.from(n);case"float64":return n instanceof Float64Array?n:Float64Array.from(n);default:throw new Error(`TensorData type ${e} is not supported`)}}toTextureData(e,n){if(n)return n instanceof Float32Array?n:new Float32Array(n)}toEncoderType(e){return"float"}clearActiveTextures(){this.glContext.clearActiveTextures()}}});var da,Ry=L(()=>{"use strict";Dt();Tf();Om();xy();Ny();Ql();Ly();da=class{constructor(e,n){this.backend=e;this.context=n;this.layoutStrategy=new na(e.glContext.maxTextureSize),this.programManager=new la(this.context.profiler,e.glContext,this.layoutStrategy),this.textureManager=new ca(e.glContext,this.layoutStrategy,this.context.profiler,{reuseTextures:e.textureCacheMode==="full"}),this.packedTextureDataCache=new Map,this.unpackedTextureDataCache=new Map,this.pack=e.pack,this.pack2unpackMap=new Map,this.unpack2packMap=new Map}createInferenceHandler(){return new Hi(this)}onGraphInitialized(e){let n=e.getValues().filter(t=>t.from===-1&&t.tensor).map(t=>t.tensor.dataId);this.initializers=new Set(n)}isInitializer(e){return this.initializers?this.initializers.has(e):!1}addInitializer(e){this.initializers.add(e)}getTextureData(e,n){return n?this.packedTextureDataCache.get(e):this.unpackedTextureDataCache.get(e)}setTextureData(e,n,t=!1){Ge.verbose("WebGLSessionHandler","Storing Texture data in cache"),t?this.packedTextureDataCache.set(e,n):this.unpackedTextureDataCache.set(e,n)}dispose(){this.programManager.dispose(),this.textureManager.clearActiveTextures(),this.packedTextureDataCache.forEach(e=>this.textureManager.releaseTexture(e,!0)),this.packedTextureDataCache=new Map,this.unpackedTextureDataCache.forEach(e=>this.textureManager.releaseTexture(e,!0)),this.unpackedTextureDataCache=new Map}resolve(e,n,t){let o=xf(e,n,vy);return{impl:o.opImpl,context:o.opInit?o.opInit(e,t):e}}}});function XP(r){let e=0;for(;e<r.length&&r[e]();++e);return e-1}var Bo,zy=L(()=>{"use strict";ht();No();No();zn();Bo=class{constructor(e,n){this.frameBufferBound=!1;this.itemsToPoll=[];this.gl=e,this.version=n,this.getExtensions(),this.vertexbuffer=this.createVertexbuffer(),this.framebuffer=this.createFramebuffer(),this.queryVitalParameters()}allocateTexture(e,n,t,o){let i=this.gl,a=i.createTexture();i.bindTexture(i.TEXTURE_2D,a),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MIN_FILTER,i.NEAREST),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_MAG_FILTER,i.NEAREST),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_S,i.CLAMP_TO_EDGE),i.texParameteri(i.TEXTURE_2D,i.TEXTURE_WRAP_T,i.CLAMP_TO_EDGE);let s=o?t.encode(o,e*n):null;return i.texImage2D(i.TEXTURE_2D,0,t.internalFormat,e,n,0,t.format,t.textureType,s),this.checkError(),a}updateTexture(e,n,t,o,i){let a=this.gl;a.bindTexture(a.TEXTURE_2D,e);let s=o.encode(i,n*t);a.texSubImage2D(a.TEXTURE_2D,0,0,0,n,t,o.format,o.textureType,s),this.checkError()}attachFramebuffer(e,n,t){let o=this.gl;o.bindTexture(o.TEXTURE_2D,e),o.bindFramebuffer(o.FRAMEBUFFER,this.framebuffer),o.framebufferTexture2D(o.FRAMEBUFFER,o.COLOR_ATTACHMENT0,o.TEXTURE_2D,e,0),this.checkError(),o.viewport(0,0,n,t),o.scissor(0,0,n,t)}readTexture(e,n,t,o,i,a){let s=this.gl;a||(a=1),this.frameBufferBound||this.attachFramebuffer(e,n,t);let u=this.getEncoder(i,a),l=u.allocate(n*t);return s.bindTexture(s.TEXTURE_2D,e),s.framebufferTexture2D(s.FRAMEBUFFER,s.COLOR_ATTACHMENT0,s.TEXTURE_2D,e,0),s.readPixels(0,0,n,t,s.RGBA,u.textureType,l),this.checkError(),u.decode(l,o)}isFramebufferReady(){return!0}getActiveTexture(){let e=this.gl;return`TEXTURE${e.getParameter(this.gl.ACTIVE_TEXTURE)-e.TEXTURE0}`}getTextureBinding(){return this.gl.getParameter(this.gl.TEXTURE_BINDING_2D)}getFramebufferBinding(){return this.gl.getParameter(this.gl.FRAMEBUFFER_BINDING)}setVertexAttributes(e,n){let t=this.gl;t.vertexAttribPointer(e,3,t.FLOAT,!1,20,0),t.enableVertexAttribArray(e),n!==-1&&(t.vertexAttribPointer(n,2,t.FLOAT,!1,20,12),t.enableVertexAttribArray(n)),this.checkError()}createProgram(e,n){let t=this.gl,o=t.createProgram();return t.attachShader(o,e),t.attachShader(o,n),t.linkProgram(o),o}compileShader(e,n){let t=this.gl,o=t.createShader(n);if(!o)throw new Error(`createShader() returned null with type ${n}`);if(t.shaderSource(o,e),t.compileShader(o),t.getShaderParameter(o,t.COMPILE_STATUS)===!1)throw new Error(`Failed to compile shader: ${t.getShaderInfoLog(o)}
Shader source:
${e}`);return o}deleteShader(e){this.gl.deleteShader(e)}bindTextureToUniform(e,n,t){let o=this.gl;o.activeTexture(o.TEXTURE0+n),this.checkError(),o.bindTexture(o.TEXTURE_2D,e),this.checkError(),o.uniform1i(t,n),this.checkError()}draw(){this.gl.drawArrays(this.gl.TRIANGLE_STRIP,0,4),this.checkError()}checkError(){if(he.debug){let e=this.gl,n=e.getError(),t="";switch(n){case e.NO_ERROR:return;case e.INVALID_ENUM:t="INVALID_ENUM";break;case e.INVALID_VALUE:t="INVALID_VALUE";break;case e.INVALID_OPERATION:t="INVALID_OPERATION";break;case e.INVALID_FRAMEBUFFER_OPERATION:t="INVALID_FRAMEBUFFER_OPERATION";break;case e.OUT_OF_MEMORY:t="OUT_OF_MEMORY";break;case e.CONTEXT_LOST_WEBGL:t="CONTEXT_LOST_WEBGL";break;default:t=`Unknown WebGL Error: ${n.toString(16)}`}throw new Error(t)}}deleteTexture(e){this.gl.deleteTexture(e)}deleteProgram(e){this.gl.deleteProgram(e)}getEncoder(e,n,t=0){if(this.version===2)return new Fi(this.gl,n);switch(e){case"float":return t===1||this.isRenderFloat32Supported?new ko(this.gl,n):new ko(this.gl,n,this.textureHalfFloatExtension.HALF_FLOAT_OES);case"int":throw new Error("not implemented");case"byte":return new Wi(this.gl,n);default:throw new Error(`Invalid dataType: ${e}`)}}clearActiveTextures(){let e=this.gl;for(let n=0;n<this.maxTextureImageUnits;++n)e.activeTexture(e.TEXTURE0+n),e.bindTexture(e.TEXTURE_2D,null)}dispose(){if(this.disposed)return;let e=this.gl;e.bindFramebuffer(e.FRAMEBUFFER,null),e.deleteFramebuffer(this.framebuffer),e.bindBuffer(e.ARRAY_BUFFER,null),e.deleteBuffer(this.vertexbuffer),e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,null),e.finish(),this.disposed=!0}createDefaultGeometry(){return new Float32Array([-1,1,0,0,1,-1,-1,0,0,0,1,1,0,1,1,1,-1,0,1,0])}createVertexbuffer(){let e=this.gl,n=e.createBuffer();if(!n)throw new Error("createBuffer() returned null");let t=this.createDefaultGeometry();return e.bindBuffer(e.ARRAY_BUFFER,n),e.bufferData(e.ARRAY_BUFFER,t,e.STATIC_DRAW),this.checkError(),n}createFramebuffer(){let e=this.gl.createFramebuffer();if(!e)throw new Error("createFramebuffer returned null");return e}queryVitalParameters(){let e=this.gl;if(this.isFloatTextureAttachableToFrameBuffer=this.checkFloatTextureAttachableToFrameBuffer(),this.isRenderFloat32Supported=this.checkRenderFloat32(),this.isFloat32DownloadSupported=this.checkFloat32Download(),this.version===1&&!this.textureHalfFloatExtension&&!this.isRenderFloat32Supported)throw new Error("both float32 and float16 TextureType are not supported");this.isBlendSupported=!this.isRenderFloat32Supported||this.checkFloat32Blend(),this.maxTextureSize=e.getParameter(e.MAX_TEXTURE_SIZE),this.maxTextureImageUnits=e.getParameter(e.MAX_TEXTURE_IMAGE_UNITS),this.version}getExtensions(){this.version===2?(this.colorBufferFloatExtension=this.gl.getExtension("EXT_color_buffer_float"),this.disjointTimerQueryWebgl2Extension=this.gl.getExtension("EXT_disjoint_timer_query_webgl2")):(this.textureFloatExtension=this.gl.getExtension("OES_texture_float"),this.textureHalfFloatExtension=this.gl.getExtension("OES_texture_half_float"))}checkFloatTextureAttachableToFrameBuffer(){let e=this.gl,n=e.createTexture();e.bindTexture(e.TEXTURE_2D,n);let t=this.version===2?e.RGBA32F:e.RGBA;e.texImage2D(e.TEXTURE_2D,0,t,1,1,0,e.RGBA,e.FLOAT,null);let o=e.createFramebuffer();e.bindFramebuffer(e.FRAMEBUFFER,o),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,n,0);let i=e.checkFramebufferStatus(e.FRAMEBUFFER)===e.FRAMEBUFFER_COMPLETE;return e.bindTexture(e.TEXTURE_2D,null),e.bindFramebuffer(e.FRAMEBUFFER,null),e.deleteTexture(n),e.deleteFramebuffer(o),i}checkRenderFloat32(){if(this.version===2){if(!this.colorBufferFloatExtension)return!1}else if(!this.textureFloatExtension)return!1;return this.isFloatTextureAttachableToFrameBuffer}checkFloat32Download(){if(this.version===2){if(!this.colorBufferFloatExtension)return!1}else if(!this.textureFloatExtension||!this.gl.getExtension("WEBGL_color_buffer_float"))return!1;return this.isFloatTextureAttachableToFrameBuffer}checkFloat32Blend(){let e=this.gl,n,t,o,i,a;try{n=e.createTexture(),t=e.createFramebuffer(),e.bindTexture(e.TEXTURE_2D,n);let s=this.version===2?e.RGBA32F:e.RGBA;return e.texImage2D(e.TEXTURE_2D,0,s,1,1,0,e.RGBA,e.FLOAT,null),e.bindFramebuffer(e.FRAMEBUFFER,t),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,n,0),e.enable(e.BLEND),o=e.createShader(e.VERTEX_SHADER),!o||(e.shaderSource(o,"void main(){}"),e.compileShader(o),i=e.createShader(e.FRAGMENT_SHADER),!i)||(e.shaderSource(i,"precision highp float;void main(){gl_FragColor=vec4(0.5);}"),e.compileShader(i),a=e.createProgram(),!a)?!1:(e.attachShader(a,o),e.attachShader(a,i),e.linkProgram(a),e.useProgram(a),e.drawArrays(e.POINTS,0,1),e.getError()===e.NO_ERROR)}finally{e.disable(e.BLEND),a&&e.deleteProgram(a),o&&e.deleteShader(o),i&&e.deleteShader(i),t&&(e.bindFramebuffer(e.FRAMEBUFFER,null),e.deleteFramebuffer(t)),n&&(e.bindTexture(e.TEXTURE_2D,null),e.deleteTexture(n))}}beginTimer(){if(this.version===2&&this.disjointTimerQueryWebgl2Extension){let e=this.gl,n=this.disjointTimerQueryWebgl2Extension,t=e.createQuery();return e.beginQuery(n.TIME_ELAPSED_EXT,t),t}else throw new Error("WebGL1 profiling currently not supported.")}endTimer(){if(this.version===2&&this.disjointTimerQueryWebgl2Extension){let e=this.gl,n=this.disjointTimerQueryWebgl2Extension;e.endQuery(n.TIME_ELAPSED_EXT);return}else throw new Error("WebGL1 profiling currently not supported")}isTimerResultAvailable(e){let n=!1,t=!1;if(this.version===2&&this.disjointTimerQueryWebgl2Extension){let o=this.gl,i=this.disjointTimerQueryWebgl2Extension;n=o.getQueryParameter(e,o.QUERY_RESULT_AVAILABLE),t=o.getParameter(i.GPU_DISJOINT_EXT)}else throw new Error("WebGL1 profiling currently not supported");return n&&!t}getTimerResult(e){let n=0;if(this.version===2){let t=this.gl;n=t.getQueryParameter(e,t.QUERY_RESULT),t.deleteQuery(e)}else throw new Error("WebGL1 profiling currently not supported");return n/1e6}async waitForQueryAndGetTime(e){return await Sl(()=>this.isTimerResultAvailable(e)),this.getTimerResult(e)}async createAndWaitForFence(){let e=this.createFence(this.gl);return this.pollFence(e)}createFence(e){let n,t=e,o=t.fenceSync(t.SYNC_GPU_COMMANDS_COMPLETE,0);return e.flush(),o===null?n=()=>!0:n=()=>{let i=t.clientWaitSync(o,0,0);return i===t.ALREADY_SIGNALED||i===t.CONDITION_SATISFIED},{query:o,isFencePassed:n}}async pollFence(e){return new Promise(n=>{this.addItemToPoll(()=>e.isFencePassed(),()=>n())})}pollItems(){let e=XP(this.itemsToPoll.map(n=>n.isDoneFn));for(let n=0;n<=e;++n){let{resolveFn:t}=this.itemsToPoll[n];t()}this.itemsToPoll=this.itemsToPoll.slice(e+1)}async addItemToPoll(e,n){this.itemsToPoll.push({isDoneFn:e,resolveFn:n}),!(this.itemsToPoll.length>1)&&await Sl(()=>(this.pollItems(),this.itemsToPoll.length===0))}}});function tc(r){let e;if((!r||r==="webgl2")&&"webgl2"in so?e=so.webgl2:(!r||r==="webgl")&&"webgl"in so&&(e=so.webgl),!e)try{let t=JP();e=My(t,r)}catch{let t=ZP();e=My(t,r)}r=r||e.version===1?"webgl":"webgl2";let n=e.gl;return so[r]=e,n.isContextLost()?(delete so[r],tc(r)):(n.disable(n.DEPTH_TEST),n.disable(n.STENCIL_TEST),n.disable(n.BLEND),n.disable(n.DITHER),n.disable(n.POLYGON_OFFSET_FILL),n.disable(n.SAMPLE_COVERAGE),n.enable(n.SCISSOR_TEST),n.enable(n.CULL_FACE),n.cullFace(n.BACK),e)}function My(r,e){let n={alpha:!1,depth:!1,antialias:!1,stencil:!1,preserveDrawingBuffer:!1,premultipliedAlpha:!1,failIfMajorPerformanceCaveat:!1},t,o=n;if((!e||e==="webgl2")&&(t=r.getContext("webgl2",o),t))try{return new Bo(t,2)}catch(i){Ge.warning("GlContextFactory",`failed to create WebGLContext using contextId 'webgl2'. Error: ${i}`)}if((!e||e==="webgl")&&(t=r.getContext("webgl",o)||r.getContext("experimental-webgl",o),t))try{return new Bo(t,1)}catch(i){Ge.warning("GlContextFactory",`failed to create WebGLContext using contextId 'webgl' or 'experimental-webgl'. Error: ${i}`)}throw new Error("WebGL is not supported")}function ZP(){if(typeof document>"u")throw new TypeError("failed to create canvas: document is not supported");let r=document.createElement("canvas");return r.width=1,r.height=1,r}function JP(){if(typeof OffscreenCanvas>"u")throw new TypeError("failed to create offscreen canvas: OffscreenCanvas is not supported");return new OffscreenCanvas(1,1)}var so,By=L(()=>{"use strict";Dt();zy();so={}});var pa,Vy=L(()=>{"use strict";ht();Dt();Ry();By();pa=class{get contextId(){return he.webgl.contextId}set contextId(e){he.webgl.contextId=e}get matmulMaxBatchSize(){return he.webgl.matmulMaxBatchSize}set matmulMaxBatchSize(e){he.webgl.matmulMaxBatchSize=e}get textureCacheMode(){return he.webgl.textureCacheMode}set textureCacheMode(e){he.webgl.textureCacheMode=e}get pack(){return he.webgl.pack}set pack(e){he.webgl.pack=e}get async(){return he.webgl.async}set async(e){he.webgl.async=e}initialize(){try{return this.glContext=tc(this.contextId),typeof this.matmulMaxBatchSize!="number"&&(this.matmulMaxBatchSize=16),typeof this.textureCacheMode!="string"&&(this.textureCacheMode="full"),typeof this.pack!="boolean"&&(this.pack=!1),typeof this.async!="boolean"&&(this.async=!1),Ge.setWithEnv(he),he.webgl.context||Object.defineProperty(he.webgl,"context",{value:this.glContext.gl}),Ge.verbose("WebGLBackend",`Created WebGLContext: ${typeof this.glContext} with matmulMaxBatchSize: ${this.matmulMaxBatchSize}; textureCacheMode: ${this.textureCacheMode}; pack: ${this.pack}; async: ${this.async}.`),!0}catch(e){return Ge.warning("WebGLBackend",`Unable to initialize WebGLBackend. ${e}`),!1}}createSessionHandler(e){return new da(this,e)}dispose(){this.glContext.dispose()}}});async function nc(r){if(r){let e=typeof r=="string"?[r]:r;for(let n of e){let t=Gy.get(n);if(t)return t;let o=await QP(n);if(o)return o}}else return nc(["webgl"]);throw new Error("no available backend to use")}async function QP(r){let e=YP;if(typeof e[r]<"u"&&e3(e[r])){let n=e[r],t=n.initialize();if(typeof t=="object"&&"then"in t&&(t=await t),t)return Gy.set(r,n),n}}function e3(r){let e=r;return"initialize"in e&&typeof e.initialize=="function"&&"createSessionHandler"in e&&typeof e.createSessionHandler=="function"&&"dispose"in e&&typeof e.dispose=="function"}var Gy,YP,Uy=L(()=>{"use strict";Vy();Gy=new Map,YP={webgl:new pa}});var rc,fa,Fy=L(()=>{"use strict";Dt();rc=class{constructor(e,n){this.op=e;this.node=n}},fa=class{constructor(e,n,t){this.graph=e;this.profiler=t;this.initialize(n)}initialize(e){this.profiler.event("session","ExecutionPlan.initialize",()=>{let n=this.graph.getNodes();if(n.length!==e.length)throw new Error("The size of nodes and OPs do not match.");this._ops=e.map((t,o)=>new rc(t,n[o])),this.reset(),this._starter=[],this._ops.forEach((t,o)=>{let i=!0;for(let a of t.node.inputs)if(!this._values[a]&&this.graph.getInputIndices().indexOf(a)===-1){i=!1;break}i&&this._starter.push(o)})})}reset(){this._values=this.graph.getValues().map(e=>e.tensor)}async execute(e,n){return this.profiler.event("session","ExecutionPlan.execute",async()=>{this.reset();let t=e.createInferenceHandler(),o=this.graph.getInputIndices();if(n.length!==o.length)throw new Error(`number of input tensors don't match the number of inputs to the model: actual: ${n.length} expected: ${o.length}`);n.forEach((d,p)=>{let h=o[p];this._values[h]=d});let i=this._starter.slice(0),a=this.graph.getValues(),s=this.graph.getNodes(),u=0;for(;u<i.length;){let d=i[u++],p=this._ops[d],h=p.node.inputs.map(S=>this._values[S]);if(h.indexOf(void 0)!==-1)throw new Error(`unresolved input detected: op: ${p.node}`);let g=h;Ge.verbose("ExecPlan",`Running op:${p.node.name} (${g.map((S,v)=>`'${p.node.inputs[v]}': ${S.type}[${S.dims.join(",")}]`).join(", ")})`);let b=await this.profiler.event("node",p.node.name,async()=>p.op.impl(t,g,p.op.context));if(b.length!==p.node.outputs.length)throw new Error("the size of output does not match model definition.");b.forEach((S,v)=>{let x=p.node.outputs[v];if(this._values[x])throw new Error(`output [${x}] already has value: op:${p.node.name}`);this._values[x]=S});let _=new Set;b.forEach((S,v)=>{let x=p.node.outputs[v];for(let $ of a[x].to){let O=s[$],E=!0;for(let D of O.inputs)if(!this._values[D]){E=!1;break}E&&_.add($)}}),i.push(..._)}let l=[];for(let d=0;d<this.graph.getOutputIndices().length;d++){let p=this.graph.getOutputIndices()[d],h=this._values[p];if(h===void 0)throw new Error(`required output [${p}] does not have value`);p===0?await h.getData():h.data,l.push(h)}return Ge.verbose("ExecPlan","disposing of inferenceHandler"),t.dispose(),l})}}});var Ae,Vo,Wy=L(()=>{"use strict";$o();Ae=ve(Qr());Nr();Be();Vo=class r{constructor(e){if(this._attributes=new Map,e!=null){for(let n of e)n instanceof Ae.onnx.AttributeProto?this._attributes.set(n.name,[r.getValue(n),r.getType(n)]):n instanceof Li.Attribute&&this._attributes.set(n.name(),[r.getValue(n),r.getType(n)]);if(this._attributes.size<e.length)throw new Error("duplicated attribute names")}}set(e,n,t){this._attributes.set(e,[t,n])}delete(e){this._attributes.delete(e)}getFloat(e,n){return this.get(e,"float",n)}getInt(e,n){return this.get(e,"int",n)}getString(e,n){return this.get(e,"string",n)}getTensor(e,n){return this.get(e,"tensor",n)}getFloats(e,n){return this.get(e,"floats",n)}getInts(e,n){return this.get(e,"ints",n)}getStrings(e,n){return this.get(e,"strings",n)}getTensors(e,n){return this.get(e,"tensors",n)}get(e,n,t){let o=this._attributes.get(e);if(o===void 0){if(t!==void 0)return t;throw new Error(`required attribute not found: ${e}`)}if(o[1]!==n)throw new Error(`type mismatch: expected ${n} but got ${o[1]}`);return o[0]}static getType(e){let n=e instanceof Ae.onnx.AttributeProto?e.type:e.type();switch(n){case Ae.onnx.AttributeProto.AttributeType.FLOAT:return"float";case Ae.onnx.AttributeProto.AttributeType.INT:return"int";case Ae.onnx.AttributeProto.AttributeType.STRING:return"string";case Ae.onnx.AttributeProto.AttributeType.TENSOR:return"tensor";case Ae.onnx.AttributeProto.AttributeType.FLOATS:return"floats";case Ae.onnx.AttributeProto.AttributeType.INTS:return"ints";case Ae.onnx.AttributeProto.AttributeType.STRINGS:return"strings";case Ae.onnx.AttributeProto.AttributeType.TENSORS:return"tensors";default:throw new Error(`attribute type is not supported yet: ${Ae.onnx.AttributeProto.AttributeType[n]}`)}}static getValue(e){let n=e instanceof Ae.onnx.AttributeProto?e.type:e.type();if(n===Ae.onnx.AttributeProto.AttributeType.GRAPH||n===Ae.onnx.AttributeProto.AttributeType.GRAPHS)throw new Error("graph attribute is not supported yet");let t=this.getValueNoCheck(e);if(n===Ae.onnx.AttributeProto.AttributeType.INT&&Tt.isLong(t))return Tt.longToNumber(t);if(n===Ae.onnx.AttributeProto.AttributeType.INTS){let o=t,i=new Array(o.length);for(let a=0;a<o.length;a++){let s=o[a];i[a]=Tt.longToNumber(s)}return i}if(n===Ae.onnx.AttributeProto.AttributeType.TENSOR)return e instanceof Ae.onnx.AttributeProto?it.fromProto(t):it.fromOrtTensor(t);if(n===Ae.onnx.AttributeProto.AttributeType.TENSORS){if(e instanceof Ae.onnx.AttributeProto)return t.map(i=>it.fromProto(i));if(e instanceof Li.Attribute)return t.map(i=>it.fromOrtTensor(i))}return n===Ae.onnx.AttributeProto.AttributeType.STRING&&e instanceof Ae.onnx.AttributeProto?Do(t):n===Ae.onnx.AttributeProto.AttributeType.STRINGS&&e instanceof Ae.onnx.AttributeProto?t.map(Do):t}static getValueNoCheck(e){return e instanceof Ae.onnx.AttributeProto?this.getValueNoCheckFromOnnxFormat(e):this.getValueNoCheckFromOrtFormat(e)}static getValueNoCheckFromOnnxFormat(e){switch(e.type){case Ae.onnx.AttributeProto.AttributeType.FLOAT:return e.f;case Ae.onnx.AttributeProto.AttributeType.INT:return e.i;case Ae.onnx.AttributeProto.AttributeType.STRING:return e.s;case Ae.onnx.AttributeProto.AttributeType.TENSOR:return e.t;case Ae.onnx.AttributeProto.AttributeType.GRAPH:return e.g;case Ae.onnx.AttributeProto.AttributeType.FLOATS:return e.floats;case Ae.onnx.AttributeProto.AttributeType.INTS:return e.ints;case Ae.onnx.AttributeProto.AttributeType.STRINGS:return e.strings;case Ae.onnx.AttributeProto.AttributeType.TENSORS:return e.tensors;case Ae.onnx.AttributeProto.AttributeType.GRAPHS:return e.graphs;default:throw new Error(`unsupported attribute type: ${Ae.onnx.AttributeProto.AttributeType[e.type]}`)}}static getValueNoCheckFromOrtFormat(e){switch(e.type()){case zt.AttributeType.FLOAT:return e.f();case zt.AttributeType.INT:return e.i();case zt.AttributeType.STRING:return e.s();case zt.AttributeType.TENSOR:return e.t();case zt.AttributeType.GRAPH:return e.g();case zt.AttributeType.FLOATS:return e.floatsArray();case zt.AttributeType.INTS:{let n=[];for(let t=0;t<e.intsLength();t++)n.push(e.ints(t));return n}case zt.AttributeType.STRINGS:{let n=[];for(let t=0;t<e.stringsLength();t++)n.push(e.strings(t));return n}case zt.AttributeType.TENSORS:{let n=[];for(let t=0;t<e.tensorsLength();t++)n.push(e.tensors(t));return n}default:throw new Error(`unsupported attribute type: ${zt.AttributeType[e.type()]}`)}}}});var ic,ac,Vn,ha,oc,Hy=L(()=>{"use strict";Wy();$o();ic=ve(Qr());Nr();Be();ac={from:(r,e)=>new oc(r,e)},Vn=class{constructor(e){this._from=void 0,this._to=[],this.tensor=void 0,this.type=void 0,e&&(this.type=mt.tensorValueTypeFromProto(e.type.tensorType))}get from(){return this._from}get to(){return this._to}},ha=class{constructor(e,n){e instanceof ic.onnx.NodeProto?(this.name=e.name,this.opType=e.opType,this.attributes=new Vo(e.attribute)):e instanceof il.Node&&(this.name=n??e.name(),this.opType=e.opType(),this.attributes=new Vo(mt.tensorAttributesFromORTFormat(e))),this.inputs=[],this.outputs=[],this.executeNode=!0}},oc=class{constructor(e,n){if(!e)throw new TypeError("graph is empty");this.buildGraph(e),this.transformGraph(n),this.checkIsAcyclic()}getInputIndices(){return this._allInputIndices}getInputNames(){return this._allInputNames}getOutputIndices(){return this._allOutputIndices}getOutputNames(){return this._allOutputNames}getValues(){return this._allData}getNodes(){return this._nodes}buildGraph(e){if(e instanceof ic.onnx.GraphProto)this.buildGraphFromOnnxFormat(e);else if(e instanceof rl.Graph)this.buildGraphFromOrtFormat(e);else throw new TypeError("Graph type is not supported.")}buildGraphFromOnnxFormat(e){let n=new Map;this._allData=[],this._allInputIndices=[],this._allInputNames=[],this._allOutputIndices=[],this._allOutputNames=[],this._nodes=[];let t=new Map;if(!e.input)throw new Error("missing information in graph: input");let o=[];for(let i of e.input){if(n.has(i.name))throw new Error(`duplicated input name: ${i.name}`);let a=this._allData.push(new Vn(i))-1;n.set(i.name,a),o.push(i.name)}if(!e.initializer)throw new Error("missing information in graph: initializer");for(let i of e.initializer){let a=n.get(i.name);if(a===void 0){let s=new Vn;s.type={shape:{dims:mt.tensorDimsFromProto(i.dims)},tensorType:mt.tensorDataTypeFromProto(i.dataType)},a=this._allData.push(s)-1,n.set(i.name,a)}this._allData[a]._from=-1,this._allData[a].tensor=it.fromProto(i)}for(let i=0;i<this._allData.length;i++)this._allData[i].tensor||(this._allInputIndices.push(i),this._allInputNames.push(o[i]));if(!e.output)throw new Error("missing information in graph: output");for(let i of e.output){if(n.has(i.name))throw new Error(`duplicated output name: ${i.name}`);let a=this._allData.push(new Vn(i))-1;n.set(i.name,a),this._allOutputIndices.push(a),this._allOutputNames.push(i.name)}if(!e.node)throw new Error("missing information in graph: node");for(let i of e.node){if(!i.name)for(let s=0;;s++){let u=`unnamed_${i.opType}_${s}`;if(!t.has(u)){i.name=u;break}}if(t.has(i.name))throw new Error(`duplicated node name: ${i.name}`);let a=this._nodes.push(new ha(i))-1;t.set(i.name,a)}for(let i=0;i<this._nodes.length;i++){let a=this._nodes[i],s=e.node[i];if(!s.output)throw new Error(`missing output for node: ${s.name}`);for(let u of s.output){let l=n.get(u);if(typeof l>"u"&&(l=this._allData.push(new Vn)-1,n.set(u,l)),a.outputs.push(l),this._allData[l]._from!==void 0)throw new Error(`multiple nodes output to one data value: ${l}`);if(this._allData[l]._from=i,s.opType==="Constant"){if(!s.attribute||s.attribute.length!==1||!s.attribute[0].t)throw new Error("missing attributes or missing tensor value in attributes for this Constant operator");if(!s.output||s.output.length!==1)throw new Error("missing output or incorrect number of outputs for this Constant operator");a.outputs.pop(),a.executeNode=!1,this._allData[l]._from=-1,this._allData[l].tensor=it.fromProto(s.attribute[0].t)}}}for(let i=0;i<this._nodes.length;i++){let a=this._nodes[i],s=e.node[i];if(!s.input)throw new Error(`missing input for node: ${s.name}`);for(let u of s.input){let l=n.get(u);if(typeof l>"u"){if(u===""&&(s.input.length===3||s.input.length===4)&&s.opType==="Resize")continue;throw new Error(`unrecognized input '${u}' for node: ${s.name}`)}a.inputs.push(l),this._allData[l]._to.push(i)}}return!0}buildGraphFromOrtFormat(e){let n=new Map;this._allData=[],this._allInputIndices=[],this._allInputNames=[],this._allOutputIndices=[],this._allOutputNames=[],this._nodes=[];let t=new Map,o=[];for(let i=0;i<e.inputsLength();i++){let a=e.inputs(i);if(n.has(a))throw new Error(`duplicated input name: ${a}`);for(let s=0;s<e.nodeArgsLength();s++)if(e.nodeArgs(s)?.name()===a){let u=new Vn;if(e.nodeArgs(s)?.type()?.valueType()!==sl.TypeInfoValue.tensor_type)throw new Error("Unexpected value type for the nodeArg.");let d=e.nodeArgs(s).type().value(new al.TensorTypeAndShape),p=mt.tensorDataTypeFromProto(d.elemType()),h=d.shape(),g=[];for(let _=0;_<h.dimLength();_++)g.push(Tt.longToNumber(h.dim(_).value().dimValue()));u.type={shape:{dims:g},tensorType:p};let b=this._allData.push(u)-1;n.set(a,b),o.push(a)}}for(let i=0;i<e.initializersLength();i++){let a=e.initializers(i),s=n.get(a.name());if(s===void 0){let u=new Vn,l=mt.tensorDimsFromORTFormat(a),d=mt.tensorDataTypeFromProto(a.dataType());u.type={shape:{dims:l},tensorType:d},s=this._allData.push(u)-1,n.set(a.name(),s)}this._allData[s]._from=-1,this._allData[s].tensor=it.fromOrtTensor(a)}for(let i=0;i<this._allData.length;i++)this._allData[i].tensor||(this._allInputIndices.push(i),this._allInputNames.push(o[i]));for(let i=0;i<e.outputsLength();i++){let a=e.outputs(i);if(n.has(a))throw new Error(`duplicated output name: ${a}`);let s=this._allData.push(new Vn)-1;n.set(a,s),this._allOutputIndices.push(s),this._allOutputNames.push(a)}if(!e.nodes)throw new Error("missing information in graph: node");for(let i=0;i<e.nodesLength();i++){let a=e.nodes(i),s=a.name();if(!s)for(let l=0;s=`unnamed_${a.opType()}_${l}`,!!t.has(s);l++);if(t.has(s))throw new Error(`duplicated node name: ${s}`);let u=this._nodes.push(new ha(a,s))-1;t.set(s,u)}for(let i=0;i<this._nodes.length;i++){let a=this._nodes[i],s=e.nodes(i);if(s==null)throw new Error(`No node exists at index ${i}`);if(s?.outputsLength()===0)throw new Error(`missing output for node: ${s.name}`);for(let u=0;u<s?.outputsLength();u++){let l=s?.outputs(u),d=n.get(l);if(typeof d>"u"&&(d=this._allData.push(new Vn)-1,n.set(l,d)),a.outputs.push(d),this._allData[d]._from!==void 0)throw new Error(`multiple nodes output to one data value: ${d}`);if(this._allData[d]._from=i,s.opType()==="Constant"){if(s.attributesLength()!==1||!s.attributes(0).t())throw new Error("missing attributes or missing tensor value in attributes for this Constant operator");if(s.outputsLength()!==1)throw new Error("missing output or incorrect number of outputs for this Constant operator");a.outputs.pop(),a.executeNode=!1,this._allData[d]._from=-1,this._allData[d].tensor=it.fromOrtTensor(s.attributes(0).t())}}}for(let i=0;i<this._nodes.length;i++){let a=this._nodes[i],s=e.nodes(i);if(s.inputsLength()===0)throw new Error(`missing input for node: ${s.name}`);for(let u=0;u<s.inputsLength();u++){let l=s.inputs(u),d=n.get(l);if(typeof d>"u")throw new Error(`unrecognized input '${l}' for node: ${s.name()}`);a.inputs.push(d),this._allData[d]._to.push(i)}}}checkIsAcyclic(){let e=new Set;this._allInputIndices.forEach(o=>{this._allData[o]._to.forEach(a=>{e.add(a)})});let n=Array.from(e),t=new Array(this._nodes.length).fill("white");for(;n.length>0;){let o=n.pop();t[o]==="gray"?t[o]="black":(n.push(o),t[o]="gray",this._nodes[o].outputs.forEach(i=>{let a=this._allData[i];if(typeof a.tensor<"u")throw new Error("node outputs should not be initialized");if(a._from!==o)throw new Error("from property of the Value object doesn't match index of Node being processed");a._to.forEach(s=>{if(t[s]==="gray")throw new Error("model graph is cyclic");t[s]==="white"&&n.push(s)})}))}}transformGraph(e){this.removeAllIdentityNodes(),this.removeAllDropoutNodes(),this.fuseConvActivationNodes(),e&&e.transformGraph(this),this.finalizeGraph()}finalizeGraph(){let e=0,n=new Array(this._nodes.length,0),t=0;for(let o=0;o<this._nodes.length;o++)n[o]=t,this._nodes[o].executeNode?(t!==o&&(this._nodes[t]=this._nodes[o]),t++):this._nodes[o].outputs.forEach(i=>{this._allData[i]._from=-2});this._nodes.splice(t,this._nodes.length-t);for(let o=0;o<this._allData.length;o++){let i=this._allData[o];i._from!==void 0&&i._from!==-1&&i._from!==-2&&(i._from=n[i._from]);for(let a=0;a<i._to.length;a++)if(i._to[a]>=0)i._to[a]=n[i._to[a]];else throw new Error("Trying to update a removed node")}e=0;for(let o=0;o<this._allData.length;o++){if(this._allData[o].from===-2&&this._allOutputIndices.indexOf(o+e)===-1){e++,this._allData.splice(o,1),o--;continue}if(e>0){let i=-1;this._allData[o].from!==void 0&&this._allData[o].from!==-1?(i=this._nodes[this._allData[o].from].outputs.indexOf(o+e),i!==-1&&(this._nodes[this._allData[o].from].outputs[i]=o)):(i=this._allInputIndices.indexOf(o+e),i!==-1&&(this._allInputIndices[i]=o)),this._allData[o].to.forEach(a=>{i=this._nodes[a].inputs.indexOf(o+e),i!==-1&&(this._nodes[a].inputs[i]=o)}),this._allData[o].to.length===0&&(i=this._allOutputIndices.indexOf(o+e),i!==-1&&(this._allOutputIndices[i]=o))}}}deleteNode(e){let n=this._nodes[e];if(n.outputs.length>1){for(let s=1;s<n.outputs.length;s++)if(this._allData[n.outputs[s]].to.length>0)throw new Error("Node deletion with more than one output connected to other nodes is not supported. ")}n.executeNode=!1;let t=n.inputs[0],o=n.outputs[0],i=this._allData[o].to;for(let s=0;s<n.inputs.length;s++){let u=this._allData[n.inputs[s]].to.indexOf(e);if(u===-1)throw new Error("The Value object doesn't have the current Node in it's 'to' property ");this._allData[n.inputs[s]].to.splice(u,1)}this._allData[o]._to=[];let a=this._allOutputIndices.indexOf(o);if(a!==-1&&(this._allOutputIndices[a]=t),i&&i.length>0)for(let s of i){let u=this._nodes[s].inputs.indexOf(o);if(u===-1)throw new Error("The Node object doesn't have the output Value in it's 'inputs' property ");this._nodes[s].inputs[u]=t,this._allData[t].to.push(s)}}removeAllDropoutNodes(){let e=0;for(let n of this._nodes){if(n.opType==="Dropout"){if(n.inputs.length!==1)throw new Error("Dropout nodes should only contain one input. ");if(n.outputs.length!==1&&n.outputs.length!==2)throw new Error("Dropout nodes should contain either 1 or 2 output(s)");if(n.outputs.length===2&&this._allData[n.outputs[1]]._to.length!==0)throw new Error("Dropout nodes's second output should not be referenced by other nodes");this.deleteNode(e)}e++}}removeAllIdentityNodes(){let e=0;for(let n of this._nodes)n.opType==="Identity"&&this.deleteNode(e),e++}isActivation(e){switch(e.opType){case"Relu":case"Sigmoid":case"Clip":return!0;default:return!1}}fuseConvActivationNodes(){for(let e of this._nodes)if(e.opType==="Conv"){let n=this._allData[e.outputs[0]]._to;if(n.length===1&&this.isActivation(this._nodes[n[0]])){let t=this._nodes[n[0]];if(t.opType==="Clip")if(t.inputs.length===1)try{e.attributes.set("activation_params","floats",[t.attributes.getFloat("min"),t.attributes.getFloat("max")])}catch{e.attributes.set("activation_params","floats",[Dr,kr])}else if(t.inputs.length>=3&&this._allData[t.inputs[1]].tensor!==void 0&&this._allData[t.inputs[2]].tensor!==void 0)e.attributes.set("activation_params","floats",[this._allData[t.inputs[1]].tensor.floatData[0],this._allData[t.inputs[2]].tensor.floatData[0]]);else continue;e.attributes.set("activation","string",t.opType),this.deleteNode(n[0])}}}}});var qy,jy,ma,Ky=L(()=>{"use strict";qy=ve(Me());Hy();$o();jy=ve(Qr());Be();ma=class{constructor(){}load(e,n,t){let o;if(!t)try{this.loadFromOnnxFormat(e,n);return}catch(i){if(t!==void 0)throw i;o=i}try{this.loadFromOrtFormat(e,n)}catch(i){throw t!==void 0?i:new Error(`Failed to load model as ONNX format: ${o}
as ORT format: ${i}`)}}loadFromOnnxFormat(e,n){let t=jy.onnx.ModelProto.decode(e);if(Tt.longToNumber(t.irVersion)<3)throw new Error("only support ONNX model with IR_VERSION>=3");this._opsets=t.opsetImport.map(i=>({domain:i.domain,version:Tt.longToNumber(i.version)})),this._graph=ac.from(t.graph,n)}loadFromOrtFormat(e,n){let t=new qy.ByteBuffer(e),o=ol.InferenceSession.getRootAsInferenceSession(t).model();if(Tt.longToNumber(o.irVersion())<3)throw new Error("only support ONNX model with IR_VERSION>=3");this._opsets=[];for(let a=0;a<o.opsetImportLength();a++){let s=o.opsetImport(a);this._opsets.push({domain:s?.domain(),version:Tt.longToNumber(s.version())})}this._graph=ac.from(o.graph(),n)}get graph(){return this._graph}get opsets(){return this._opsets}}});var ga,Xy=L(()=>{"use strict";Uy();Fy();Dt();Ky();ga=class{constructor(e={}){this._initialized=!1,this.backendHint=e.backendHint,this.profiler=_i.create(e.profiler),this.context={profiler:this.profiler,graphInputTypes:[],graphInputDims:[]}}get inputNames(){return this._model.graph.getInputNames()}get outputNames(){return this._model.graph.getOutputNames()}startProfiling(){this.profiler.start()}endProfiling(){this.profiler.stop()}async loadModel(e,n,t){await this.profiler.event("session","Session.loadModel",async()=>{let o=await nc(this.backendHint);if(this.sessionHandler=o.createSessionHandler(this.context),this._model=new ma,typeof e=="string"){let i=e.endsWith(".ort");{let s=await(await fetch(e)).arrayBuffer();this.initialize(new Uint8Array(s),i)}}else if(ArrayBuffer.isView(e))this.initialize(e);else{let i=new Uint8Array(e,n||0,t||e.byteLength);this.initialize(i)}})}initialize(e,n){if(this._initialized)throw new Error("already initialized");this.profiler.event("session","Session.initialize",()=>{let t=this.sessionHandler.transformGraph?this.sessionHandler:void 0;this._model.load(e,t,n),this.sessionHandler.onGraphInitialized&&this.sessionHandler.onGraphInitialized(this._model.graph),this.initializeOps(this._model.graph),this._executionPlan=new fa(this._model.graph,this._ops,this.profiler)}),this._initialized=!0}async run(e){if(!this._initialized)throw new Error("session not initialized yet");return this.profiler.event("session","Session.run",async()=>{let n=this.normalizeAndValidateInputs(e),t=await this._executionPlan.execute(this.sessionHandler,n);return this.createOutput(t)})}normalizeAndValidateInputs(e){let n=this._model.graph.getInputNames();if(Array.isArray(e)){if(e.length!==n.length)throw new Error(`incorrect input array length: expected ${n.length} but got ${e.length}`)}else{if(e.size!==n.length)throw new Error(`incorrect input map size: expected ${n.length} but got ${e.size}`);let t=new Array(e.size),o=0;for(let i=0;i<n.length;++i){let a=e.get(n[i]);if(!a)throw new Error(`missing input tensor for: '${name}'`);t[o++]=a}e=t}if(!this.context.graphInputTypes||this.context.graphInputTypes.length===0||!this.context.graphInputDims||this.context.graphInputDims.length===0){let t=this._model.graph.getInputIndices(),o=this._model.graph.getValues(),i=new Array(t.length);for(let a=0;a<t.length;++a){let s=o[t[a]];i[a]=s.type.shape.dims,this.context.graphInputTypes.push(s.type.tensorType),this.context.graphInputDims.push(e[a].dims)}this.validateInputTensorDims(i,e,!0)}else this.validateInputTensorDims(this.context.graphInputDims,e,!1);return this.validateInputTensorTypes(this.context.graphInputTypes,e),e}validateInputTensorTypes(e,n){for(let t=0;t<n.length;t++){let o=e[t],i=n[t].type;if(o!==i)throw new Error(`input tensor[${t}] check failed: expected type '${o}' but got ${i}`)}}validateInputTensorDims(e,n,t){for(let o=0;o<n.length;o++){let i=e[o],a=n[o].dims;if(!this.compareTensorDims(i,a,t))throw new Error(`input tensor[${o}] check failed: expected shape '[${i.join(",")}]' but got [${a.join(",")}]`)}}compareTensorDims(e,n,t){if(e.length!==n.length)return!1;for(let o=0;o<e.length;++o)if(e[o]!==n[o]&&(!t||e[o]!==0))return!1;return!0}createOutput(e){let n=this._model.graph.getOutputNames();if(e.length!==n.length)throw new Error("expected number of outputs do not match number of generated outputs");let t=new Map;for(let o=0;o<n.length;++o)t.set(n[o],e[o]);return t}initializeOps(e){let n=e.getNodes();this._ops=new Array(n.length);for(let t=0;t<n.length;t++)this._ops[t]=this.sessionHandler.resolve(n[t],this._model.opsets,e)}}});var ba,Zy=L(()=>{"use strict";ht();Nr();ba=class{constructor(e){this.session=e;this.inputNames=this.session.inputNames,this.outputNames=this.session.outputNames}get inputMetadata(){throw new Error("Getting model metadata is not supported in webgl backend.")}get outputMetadata(){throw new Error("Getting model metadata is not supported in webgl backend.")}async dispose(){}async run(e,n,t){let o=new Map;for(let s in e)if(Object.hasOwnProperty.call(e,s)){let u=e[s];o.set(s,new it(u.dims,u.type,void 0,void 0,u.data))}let i=await this.session.run(o),a={};return i.forEach((s,u)=>{a[u]=new $t(s.type,s.data,s.dims)}),a}startProfiling(){this.session.startProfiling()}endProfiling(){this.session.endProfiling()}}});var Jy={};Ir(Jy,{onnxjsBackend:()=>t3});var sc,t3,Yy=L(()=>{"use strict";Xy();Zy();sc=class{async init(){}async createInferenceSessionHandler(e,n){let t=new ga(n);return typeof e=="string"?await t.loadModel(e):await t.loadModel(e),new ba(t)}},t3=new sc});var ya=L(()=>{"use strict"});var t_={};Ir(t_,{default:()=>n3});var Qy,e_,n3,n_=L(()=>{"use strict";uc();gr();_a();Qy="ort-wasm-proxy-worker",e_=globalThis.self?.name===Qy;e_&&(self.onmessage=r=>{let{type:e,in:n}=r.data;try{switch(e){case"init-wasm":wa(n.wasm).then(()=>{va(n).then(()=>{postMessage({type:e})},t=>{postMessage({type:e,err:t})})},t=>{postMessage({type:e,err:t})});break;case"init-ep":{let{epName:t,env:o}=n;xa(o,t).then(()=>{postMessage({type:e})},i=>{postMessage({type:e,err:i})});break}case"copy-from":{let{buffer:t}=n,o=Go(t);postMessage({type:e,out:o});break}case"create":{let{model:t,options:o}=n;Ta(t,o).then(i=>{postMessage({type:e,out:i})},i=>{postMessage({type:e,err:i})});break}case"release":Ia(n),postMessage({type:e});break;case"run":{let{sessionId:t,inputIndices:o,inputs:i,outputIndices:a,options:s}=n;Sa(t,o,i,a,new Array(a.length).fill(null),s).then(u=>{u.some(l=>l[3]!=="cpu")?postMessage({type:e,err:"Proxy does not support non-cpu tensor location."}):postMessage({type:e,out:u},Aa([...i,...u]))},u=>{postMessage({type:e,err:u})});break}case"end-profiling":$a(n),postMessage({type:e});break;default:}}catch(t){postMessage({type:e,err:t})}});n3=e_?null:r=>new Worker(r??Pt,{type:"module",name:Qy})});var o_={};Ir(o_,{default:()=>r3});async function r_(r={}){var e=r,n=!!globalThis.window,t=!!globalThis.WorkerGlobalScope,o=t&&self.name?.startsWith("em-pthread");e.mountExternalData=(c,f)=>{c.startsWith("./")&&(c=c.substring(2)),(e.Xc||(e.Xc=new Map)).set(c,f)},e.unmountExternalData=()=>{delete e.Xc},globalThis.SharedArrayBuffer??new WebAssembly.Memory({initial:0,maximum:0,shared:!0}).buffer.constructor;let i=c=>async(...f)=>{try{if(e.Yc)throw Error("Session already started");let y=e.Yc={Kd:f[0],errors:[]},m=await c(...f);if(e.Yc!==y)throw Error("Session mismatch");e.dd?.flush();let I=y.errors;if(0<I.length){let P=await Promise.all(I);if(P=P.filter(N=>N),0<P.length)throw Error(P.join(`
`))}return m}finally{e.Yc=null}};e.jsepInit=(c,f)=>{if(c==="webgpu"){[e.dd,e.Ad,e.Ed,e.ed,e.Dd,e.$b,e.Fd,e.Hd,e.Bd,e.Cd,e.Gd]=f;let y=e.dd;e.jsepRegisterBuffer=(m,I,P,N)=>y.registerBuffer(m,I,P,N),e.jsepGetBuffer=m=>y.getBuffer(m),e.jsepCreateDownloader=(m,I,P)=>y.createDownloader(m,I,P),e.jsepOnCreateSession=m=>{y.onCreateSession(m)},e.jsepOnReleaseSession=m=>{y.onReleaseSession(m)},e.jsepOnRunStart=m=>y.onRunStart(m),e.Id=(m,I)=>{y.upload(m,I)}}else if(c==="webnn"){let y=f[0];[e.Sd,e.sd,e.webnnEnsureTensor,e.td,e.webnnDownloadTensor,e.Rd,e.webnnEnableTraceEvent]=f.slice(1),e.webnnReleaseTensorId=e.sd,e.webnnUploadTensor=e.td,e.webnnRegisterMLContext=e.Rd,e.webnnOnRunStart=m=>y.onRunStart(m),e.webnnOnRunEnd=y.onRunEnd.bind(y),e.webnnOnReleaseSession=m=>{y.onReleaseSession(m)},e.webnnCreateMLTensorDownloader=(m,I)=>y.createMLTensorDownloader(m,I),e.webnnRegisterMLTensor=(m,I,P,N)=>y.registerMLTensor(m,I,P,N),e.webnnCreateMLContext=m=>y.createMLContext(m),e.webnnRegisterMLConstant=(m,I,P,N,G,Y)=>y.registerMLConstant(m,I,P,N,G,e.Xc,Y),e.webnnRegisterGraphInput=y.registerGraphInput.bind(y),e.webnnIsGraphInput=y.isGraphInput.bind(y),e.webnnRegisterGraphOutput=y.registerGraphOutput.bind(y),e.webnnIsGraphOutput=y.isGraphOutput.bind(y),e.webnnCreateTemporaryTensor=y.createTemporaryTensor.bind(y),e.webnnIsGraphInputOutputTypeSupported=y.isGraphInputOutputTypeSupported.bind(y)}};let a=()=>{let c=f=>(...y)=>{let m=tn;return y=f(...y),tn!=m?new Promise((I,P)=>{_s={resolve:I,reject:P}}):y};(()=>{for(let f of["_OrtAppendExecutionProvider","_OrtCreateSession","_OrtRun","_OrtRunWithBinding","_OrtBindInput"])e[f]=c(e[f])})(),i!==void 0&&(e._OrtRun=i(e._OrtRun),e._OrtRunWithBinding=i(e._OrtRunWithBinding)),a=void 0};e.asyncInit=()=>{a?.()};var s,u,l=(c,f)=>{throw f},d=import.meta.url,p="";if(n||t){try{p=new URL(".",d).href}catch{}t&&(u=c=>{var f=new XMLHttpRequest;return f.open("GET",c,!1),f.responseType="arraybuffer",f.send(null),new Uint8Array(f.response)}),s=async c=>{if(B(c))return new Promise((y,m)=>{var I=new XMLHttpRequest;I.open("GET",c,!0),I.responseType="arraybuffer",I.onload=()=>{I.status==200||I.status==0&&I.response?y(I.response):m(I.status)},I.onerror=m,I.send(null)});var f=await fetch(c,{credentials:"same-origin"});if(f.ok)return f.arrayBuffer();throw Error(f.status+" : "+f.url)}}var h,g,b,_,S,v,x=console.log.bind(console),$=console.error.bind(console),O=x,E=$,D=!1,B=c=>c.startsWith("file://");function T(){nr.buffer!=W.buffer&&De()}if(o){let c=function(f){try{var y=f.data,m=y.Sc;if(m==="load"){let I=[];self.onmessage=P=>I.push(P),v=()=>{postMessage({Sc:"loaded"});for(let P of I)c(P);self.onmessage=c};for(let P of y.xd)e[P]&&!e[P].proxy||(e[P]=(...N)=>{postMessage({Sc:"callHandler",wd:P,args:N})},P=="print"&&(O=e[P]),P=="printErr"&&(E=e[P]));nr=y.Od,De(),g=y.Pd,ye(),li()}else if(m==="run"){(function(I){var P=(T(),R)[I+52>>>2>>>0];I=(T(),R)[I+56>>>2>>>0],Qd(P,P-I),Te(P)})(y.Rc),Is(y.Rc,0,0,1,0,0),ed(),gs(y.Rc),F||(jd(),F=!0);try{Xx(y.Md,y.bd)}catch(I){if(I!="unwind")throw I}}else y.target!=="setimmediate"&&(m==="checkMailbox"?F&&ni():m&&(E(`worker: received unknown command ${m}`),E(y)))}catch(I){throw Kd(),I}};var CD=c,F=!1;self.onunhandledrejection=f=>{throw f.reason||f},self.onmessage=c}var W,z,te,V,w,R,j,J,Z,oe,se,pe=!1;function De(){var c=nr.buffer;e.HEAP8=W=new Int8Array(c),te=new Int16Array(c),e.HEAPU8=z=new Uint8Array(c),V=new Uint16Array(c),e.HEAP32=w=new Int32Array(c),e.HEAPU32=R=new Uint32Array(c),j=new Float32Array(c),J=new Float64Array(c),Z=new BigInt64Array(c),oe=new BigUint64Array(c)}function fe(){pe=!0,o?v():Zn.sb()}function U(c){throw E(c="Aborted("+c+")"),D=!0,c=new WebAssembly.RuntimeError(c+". Build with -sASSERTIONS for more info."),S?.(c),c}function q(){return{a:{ma:w1,gb:_1,g:Zx,J:Jx,f:Yx,o:Qx,h:eT,ha:tT,b:nT,T:rT,Ha:ad,n:oT,$:cd,Xa:dd,Da:pd,Fa:fd,Ya:hd,Va:md,Oa:gd,Ua:bd,ka:yd,Ea:_d,Ba:wd,Wa:vd,Ca:xd,bb:iT,ea:sT,wa:uT,ua:cT,da:pT,O:fT,H:hT,va:mT,_:xT,xa:TT,Ra:IT,za:$T,Ia:AT,sa:OT,fa:PT,Qa:gs,_a:ET,R:NT,r:BT,c:hs,hb:VT,y:GT,M:UT,D:FT,l:WT,s:Ed,ib:HT,I:qT,S:jT,j:KT,u:XT,q:ZT,k:JT,La:YT,Ma:QT,Na:e1,Ja:Nd,Ka:Ld,ta:Rd,db:n1,ab:i1,v:a1,aa:s1,ga:u1,$a:r1,W:l1,Za:c1,Aa:d1,F:t1,U:p1,la:si,ya:h1,fb:f1,eb:m1,Sa:Vd,Ta:Gd,Ga:ls,V:Ud,ja:Fd,Pa:Wd,ia:Hd,kb:n2,na:J1,lb:t2,oa:Z1,G:G1,e:I1,t:x1,w:v1,B:N1,mb:j1,K:M1,x:A1,pa:K1,Y:Y1,ba:q1,nb:H1,ob:W1,P:L1,qa:F1,pb:U1,N:B1,Z:X1,d:T1,A:$1,m:S1,jb:r2,p:P1,z:E1,C:O1,E:C1,L:R1,qb:V1,Q:Q1,ca:z1,X:e2,rb:k1,ra:D1,i:b1,a:nr,cb:Jo}}}async function ye(){function c(m,I){var P=Zn=m.exports;m={};for(let[N,G]of Object.entries(P))typeof G=="function"?(P=CT(G),m[N]=P):m[N]=G;return Zn=m,Zn=(function(){var N=Zn,G=ne=>we=>ne(we)>>>0,Y=ne=>()=>ne()>>>0;return(N=Object.assign({},N)).tb=G(N.tb),N.Xb=Y(N.Xb),N.Zb=G(N.Zb),N.lc=G(N.lc),N.mc=Y(N.mc),N.qc=G(N.qc),N})(),Yc.push(Zn._b),qd=(m=Zn).tb,jd=m.ub,e._OrtInit=m.vb,e._OrtGetLastError=m.wb,e._OrtCreateSessionOptions=m.xb,e._OrtAppendExecutionProvider=m.yb,e._OrtAddFreeDimensionOverride=m.zb,e._OrtAddSessionConfigEntry=m.Ab,e._OrtReleaseSessionOptions=m.Bb,e._OrtCreateSession=m.Cb,e._OrtReleaseSession=m.Db,e._OrtGetInputOutputCount=m.Eb,e._OrtGetInputOutputMetadata=m.Fb,e._OrtFree=m.Gb,e._OrtCreateTensor=m.Hb,e._OrtGetTensorData=m.Ib,e._OrtReleaseTensor=m.Jb,e._OrtCreateRunOptions=m.Kb,e._OrtAddRunConfigEntry=m.Lb,e._OrtReleaseRunOptions=m.Mb,e._OrtCreateBinding=m.Nb,e._OrtBindInput=m.Ob,e._OrtBindOutput=m.Pb,e._OrtClearBoundOutputs=m.Qb,e._OrtReleaseBinding=m.Rb,e._OrtRunWithBinding=m.Sb,e._OrtRun=m.Tb,e._OrtEndProfiling=m.Ub,e._JsepOutput=m.Vb,e._JsepGetNodeName=m.Wb,ui=m.Xb,nn=e._free=m.Yb,yo=e._malloc=m.Zb,Is=m.ac,Kd=m.bc,Xd=m.cc,Zd=m.dc,Ss=m.ec,Jd=m.fc,Yd=m.gc,$e=m.hc,_o=m.ic,Qd=m.jc,Te=m.kc,$s=m.lc,Ie=m.mc,ep=m.nc,As=m.oc,tp=m.pc,np=m.qc,rp=m.rc,Os=m.sc,op=m.tc,ip=m.uc,ap=m.vc,sp=m.wc,up=m.xc,lp=m.yc,cp=m.zc,dp=m.Ac,pp=m.Bc,fp=m.Cc,hp=m.Dc,mp=m.Ec,gp=m.Fc,bp=m.Gc,yp=m.Hc,_p=m.Ic,wp=m.Jc,vp=m.Kc,xp=m.Lc,Tp=m.Mc,Ip=m.Nc,Sp=m.Pc,$p=m.Qc,Ap=m.$c,Op=m.ad,Pp=m.fd,Ep=m.jd,Cp=m.kd,Dp=m.ld,kp=m.md,Np=m.nd,Lp=m.od,Rp=m.pd,zp=m.qd,Mp=m.vd,Bp=m.Td,Vp=m.Ud,Gp=m.Vd,Up=m.Wd,g=I,Zn}var f,y=q();return e.instantiateWasm?new Promise(m=>{e.instantiateWasm(y,(I,P)=>{m(c(I,P))})}):o?c(new WebAssembly.Instance(g,q()),g):(se??=e.locateFile?e.locateFile?e.locateFile("ort-wasm-simd-threaded.jsep.wasm",p):p+"ort-wasm-simd-threaded.jsep.wasm":new URL("ort-wasm-simd-threaded.jsep.wasm",import.meta.url).href,f=await(async function(m){var I=se;if(!h&&!B(I))try{var P=fetch(I,{credentials:"same-origin"});return await WebAssembly.instantiateStreaming(P,m)}catch(N){E(`wasm streaming compile failed: ${N}`),E("falling back to ArrayBuffer instantiation")}return(async function(N,G){try{var Y=await(async function(ne){if(!h)try{var we=await s(ne);return new Uint8Array(we)}catch{}if(ne==se&&h)ne=new Uint8Array(h);else{if(!u)throw"both async and sync fetching of the wasm failed";ne=u(ne)}return ne})(N);return await WebAssembly.instantiate(Y,G)}catch(ne){E(`failed to asynchronously prepare wasm: ${ne}`),U(ne)}})(I,m)})(y),c(f.instance,f.module))}class Je{name="ExitStatus";constructor(f){this.message=`Program terminated with exit(${f})`,this.status=f}}var Fe=c=>{c.terminate(),c.onmessage=()=>{}},st=[],ke=0,je=null,Wt=c=>{tr.length==0&&(nd(),td(tr[0]));var f=tr.pop();if(!f)return 6;go.push(f),vr[c.Rc]=f,f.Rc=c.Rc;var y={Sc:"run",Md:c.Ld,bd:c.bd,Rc:c.Rc};return f.postMessage(y,c.rd),0},St=0,qe=(c,f,...y)=>{var m,I=16*y.length,P=Ie(),N=$s(I),G=N>>>3;for(m of y)typeof m=="bigint"?((T(),Z)[G++>>>0]=1n,(T(),Z)[G++>>>0]=m):((T(),Z)[G++>>>0]=0n,(T(),J)[G++>>>0]=m);return c=Xd(c,0,I,N,f),Te(P),c};function Jo(c){if(o)return qe(0,1,c);if(b=c,!(0<St)){for(var f of go)Fe(f);for(f of tr)Fe(f);tr=[],go=[],vr={},D=!0}l(0,new Je(c))}function Jc(c){if(o)return qe(1,0,c);ls(c)}var ls=c=>{if(b=c,o)throw Jc(c),"unwind";Jo(c)},tr=[],go=[],Yc=[],vr={},Qc=c=>{var f=c.Rc;delete vr[f],tr.push(c),go.splice(go.indexOf(c),1),c.Rc=0,Zd(f)};function ed(){Yc.forEach(c=>c())}var td=c=>new Promise(f=>{c.onmessage=I=>{var P=I.data;if(I=P.Sc,P.Zc&&P.Zc!=ui()){var N=vr[P.Zc];N?N.postMessage(P,P.rd):E(`Internal error! Worker sent a message "${I}" to target pthread ${P.Zc}, but that thread no longer exists!`)}else I==="checkMailbox"?ni():I==="spawnThread"?Wt(P):I==="cleanupThread"?ti(()=>{Qc(vr[P.Nd])}):I==="loaded"?(c.loaded=!0,f(c)):P.target==="setimmediate"?c.postMessage(P):I==="uncaughtException"?c.onerror(P.error):I==="callHandler"?e[P.wd](...P.args):I&&E(`worker sent an unknown command ${I}`)},c.onerror=I=>{throw E(`worker sent an error! ${I.filename}:${I.lineno}: ${I.message}`),I};var y,m=[];for(y of[])e.propertyIsEnumerable(y)&&m.push(y);c.postMessage({Sc:"load",xd:m,Od:nr,Pd:g})});function nd(){var c=new Worker((()=>{let f=URL;return import.meta.url>"file:"&&import.meta.url<"file;"?new f("ort.all.bundle.min.mjs",import.meta.url):new URL(import.meta.url)})(),{type:"module",workerData:"em-pthread",name:"em-pthread"});tr.push(c)}var nr,Xx=(c,f)=>{St=0,c=Os(c,f),0<St?b=c:Ss(c)},Yo=[],Qo=0;function Zx(c){var f=new cs(c>>>=0);return(T(),W)[f.Tc+12>>>0]==0&&(rd(f,!0),Qo--),od(f,!1),Yo.push(f),np(c)}var Hr=0,Jx=()=>{$e(0,0);var c=Yo.pop();ep(c.cd),Hr=0};function rd(c,f){f=f?1:0,(T(),W)[c.Tc+12>>>0]=f}function od(c,f){f=f?1:0,(T(),W)[c.Tc+13>>>0]=f}class cs{constructor(f){this.cd=f,this.Tc=f-24}}var ds=c=>{var f=Hr;if(!f)return _o(0),0;var y=new cs(f);(T(),R)[y.Tc+16>>>2>>>0]=f;var m=(T(),R)[y.Tc+4>>>2>>>0];if(!m)return _o(0),f;for(var I of c){if(I===0||I===m)break;if(tp(I,m,y.Tc+16))return _o(I),f}return _o(m),f};function Yx(){return ds([])}function Qx(c){return ds([c>>>0])}function eT(c,f,y,m){return ds([c>>>0,f>>>0,y>>>0,m>>>0])}var tT=()=>{var c=Yo.pop();c||U("no exception to throw");var f=c.cd;throw(T(),W)[c.Tc+13>>>0]==0&&(Yo.push(c),od(c,!0),rd(c,!1),Qo++),As(f),Hr=f};function nT(c,f,y){var m=new cs(c>>>=0);throw f>>>=0,y>>>=0,(T(),R)[m.Tc+16>>>2>>>0]=0,(T(),R)[m.Tc+4>>>2>>>0]=f,(T(),R)[m.Tc+8>>>2>>>0]=y,As(c),Qo++,Hr=c}var rT=()=>Qo;function id(c,f,y,m){return o?qe(2,1,c,f,y,m):ad(c,f,y,m)}function ad(c,f,y,m){if(c>>>=0,f>>>=0,y>>>=0,m>>>=0,!globalThis.SharedArrayBuffer)return 6;var I=[];return o&&I.length===0?id(c,f,y,m):(c={Ld:y,Rc:c,bd:m,rd:I},o?(c.Sc="spawnThread",postMessage(c,I),0):Wt(c))}function oT(c){throw Hr||=c>>>0,Hr}var sd=globalThis.TextDecoder&&new TextDecoder,ud=(c,f,y,m)=>{if(y=f+y,m)return y;for(;c[f]&&!(f>=y);)++f;return f},ld=(c,f=0,y,m)=>{if(16<(y=ud(c,f>>>=0,y,m))-f&&c.buffer&&sd)return sd.decode(c.buffer instanceof ArrayBuffer?c.subarray(f,y):c.slice(f,y));for(m="";f<y;){var I=c[f++];if(128&I){var P=63&c[f++];if((224&I)==192)m+=String.fromCharCode((31&I)<<6|P);else{var N=63&c[f++];65536>(I=(240&I)==224?(15&I)<<12|P<<6|N:(7&I)<<18|P<<12|N<<6|63&c[f++])?m+=String.fromCharCode(I):(I-=65536,m+=String.fromCharCode(55296|I>>10,56320|1023&I))}}else m+=String.fromCharCode(I)}return m},nt=(c,f,y)=>(c>>>=0)?ld((T(),z),c,f,y):"";function cd(c,f,y){return o?qe(3,1,c,f,y):0}function dd(c,f){if(o)return qe(4,1,c,f)}function pd(c,f){if(o)return qe(5,1,c,f)}function fd(c,f,y){if(o)return qe(6,1,c,f,y)}function hd(c,f,y){return o?qe(7,1,c,f,y):0}function md(c,f){if(o)return qe(8,1,c,f)}function gd(c,f,y){if(o)return qe(9,1,c,f,y)}function bd(c,f,y,m){if(o)return qe(10,1,c,f,y,m)}function yd(c,f,y,m){if(o)return qe(11,1,c,f,y,m)}function _d(c,f,y,m){if(o)return qe(12,1,c,f,y,m)}function wd(c){if(o)return qe(13,1,c)}function vd(c,f){if(o)return qe(14,1,c,f)}function xd(c,f,y){if(o)return qe(15,1,c,f,y)}var iT=()=>U(""),en=c=>{c>>>=0;for(var f="";;){var y=(T(),z)[c++>>>0];if(!y)return f;f+=String.fromCharCode(y)}},ps={},fs={},aT={},qr=class extends Error{constructor(c){super(c),this.name="BindingError"}};function Xn(c,f,y={}){return(function(m,I,P={}){var N=I.name;if(!m)throw new qr(`type "${N}" must have a positive integer typeid pointer`);if(fs.hasOwnProperty(m)){if(P.yd)return;throw new qr(`Cannot register type '${N}' twice`)}fs[m]=I,delete aT[m],ps.hasOwnProperty(m)&&(I=ps[m],delete ps[m],I.forEach(G=>G()))})(c,f,y)}var Td=(c,f,y)=>{switch(f){case 1:return y?m=>(T(),W)[m>>>0]:m=>(T(),z)[m>>>0];case 2:return y?m=>(T(),te)[m>>>1>>>0]:m=>(T(),V)[m>>>1>>>0];case 4:return y?m=>(T(),w)[m>>>2>>>0]:m=>(T(),R)[m>>>2>>>0];case 8:return y?m=>(T(),Z)[m>>>3>>>0]:m=>(T(),oe)[m>>>3>>>0];default:throw new TypeError(`invalid integer width (${f}): ${c}`)}};function sT(c,f,y,m,I){c>>>=0,y>>>=0,f=en(f>>>0);let P=N=>N;if(m=m===0n){let N=8*y;P=G=>BigInt.asUintN(N,G),I=P(I)}Xn(c,{name:f,Oc:P,Vc:(N,G)=>(typeof G=="number"&&(G=BigInt(G)),G),Uc:Td(f,y,!m),Wc:null})}function uT(c,f,y,m){Xn(c>>>=0,{name:f=en(f>>>0),Oc:function(I){return!!I},Vc:function(I,P){return P?y:m},Uc:function(I){return this.Oc((T(),z)[I>>>0])},Wc:null})}var Id=[],xr=[0,1,,1,null,1,!0,1,!1,1];function hs(c){9<(c>>>=0)&&--xr[c+1]===0&&(xr[c]=void 0,Id.push(c))}var Ct=c=>{if(!c)throw new qr(`Cannot use deleted val. handle = ${c}`);return xr[c]},Ht=c=>{switch(c){case void 0:return 2;case null:return 4;case!0:return 6;case!1:return 8;default:let f=Id.pop()||xr.length;return xr[f]=c,xr[f+1]=1,f}};function ms(c){return this.Oc((T(),R)[c>>>2>>>0])}var lT={name:"emscripten::val",Oc:c=>{var f=Ct(c);return hs(c),f},Vc:(c,f)=>Ht(f),Uc:ms,Wc:null};function cT(c){return Xn(c>>>0,lT)}var dT=(c,f)=>{switch(f){case 4:return function(y){return this.Oc((T(),j)[y>>>2>>>0])};case 8:return function(y){return this.Oc((T(),J)[y>>>3>>>0])};default:throw new TypeError(`invalid float width (${f}): ${c}`)}};function pT(c,f,y){y>>>=0,Xn(c>>>=0,{name:f=en(f>>>0),Oc:m=>m,Vc:(m,I)=>I,Uc:dT(f,y),Wc:null})}function fT(c,f,y,m,I){c>>>=0,y>>>=0,f=en(f>>>0);let P=G=>G;if(m===0){var N=32-8*y;P=G=>G<<N>>>N,I=P(I)}Xn(c,{name:f,Oc:P,Vc:(G,Y)=>Y,Uc:Td(f,y,m!==0),Wc:null})}function hT(c,f,y){function m(P){var N=(T(),R)[P>>>2>>>0];return P=(T(),R)[P+4>>>2>>>0],new I((T(),W).buffer,P,N)}var I=[Int8Array,Uint8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array][f];Xn(c>>>=0,{name:y=en(y>>>0),Oc:m,Uc:m},{yd:!0})}var rr=(c,f,y)=>{var m=(T(),z);if(f>>>=0,0<y){var I=f;y=f+y-1;for(var P=0;P<c.length;++P){var N=c.codePointAt(P);if(127>=N){if(f>=y)break;m[f++>>>0]=N}else if(2047>=N){if(f+1>=y)break;m[f++>>>0]=192|N>>6,m[f++>>>0]=128|63&N}else if(65535>=N){if(f+2>=y)break;m[f++>>>0]=224|N>>12,m[f++>>>0]=128|N>>6&63,m[f++>>>0]=128|63&N}else{if(f+3>=y)break;m[f++>>>0]=240|N>>18,m[f++>>>0]=128|N>>12&63,m[f++>>>0]=128|N>>6&63,m[f++>>>0]=128|63&N,P++}}m[f>>>0]=0,c=f-I}else c=0;return c},ei=c=>{for(var f=0,y=0;y<c.length;++y){var m=c.charCodeAt(y);127>=m?f++:2047>=m?f+=2:55296<=m&&57343>=m?(f+=4,++y):f+=3}return f};function mT(c,f){Xn(c>>>=0,{name:f=en(f>>>0),Oc(y){var m=(T(),R)[y>>>2>>>0];return m=nt(y+4,m,!0),nn(y),m},Vc(y,m){m instanceof ArrayBuffer&&(m=new Uint8Array(m));var I=typeof m=="string";if(!(I||ArrayBuffer.isView(m)&&m.BYTES_PER_ELEMENT==1))throw new qr("Cannot pass non-string to std::string");var P=I?ei(m):m.length,N=yo(4+P+1),G=N+4;return(T(),R)[N>>>2>>>0]=P,I?rr(m,G,P+1):(T(),z).set(m,G>>>0),y!==null&&y.push(nn,N),N},Uc:ms,Wc(y){nn(y)}})}var Sd=globalThis.TextDecoder?new TextDecoder("utf-16le"):void 0,gT=(c,f,y)=>{if(c>>>=1,16<(f=ud((T(),V),c,f/2,y))-c&&Sd)return Sd.decode((T(),V).slice(c,f));for(y="";c<f;++c){var m=(T(),V)[c>>>0];y+=String.fromCharCode(m)}return y},bT=(c,f,y)=>{if(y??=2147483647,2>y)return 0;var m=f;y=(y-=2)<2*c.length?y/2:c.length;for(var I=0;I<y;++I){var P=c.charCodeAt(I);(T(),te)[f>>>1>>>0]=P,f+=2}return(T(),te)[f>>>1>>>0]=0,f-m},yT=c=>2*c.length,_T=(c,f,y)=>{var m="";c>>>=2;for(var I=0;!(I>=f/4);I++){var P=(T(),R)[c+I>>>0];if(!P&&!y)break;m+=String.fromCodePoint(P)}return m},wT=(c,f,y)=>{if(f>>>=0,y??=2147483647,4>y)return 0;var m=f;y=m+y-4;for(var I=0;I<c.length;++I){var P=c.codePointAt(I);if(65535<P&&I++,(T(),w)[f>>>2>>>0]=P,(f+=4)+4>y)break}return(T(),w)[f>>>2>>>0]=0,f-m},vT=c=>{for(var f=0,y=0;y<c.length;++y)65535<c.codePointAt(y)&&y++,f+=4;return f};function xT(c,f,y){if(c>>>=0,f>>>=0,y=en(y>>>=0),f===2)var m=gT,I=bT,P=yT;else m=_T,I=wT,P=vT;Xn(c,{name:y,Oc:N=>{var G=(T(),R)[N>>>2>>>0];return G=m(N+4,G*f,!0),nn(N),G},Vc:(N,G)=>{if(typeof G!="string")throw new qr(`Cannot pass non-string to C++ string type ${y}`);var Y=P(G),ne=yo(4+Y+f);return(T(),R)[ne>>>2>>>0]=Y/f,I(G,ne+4,Y+f),N!==null&&N.push(nn,ne),ne},Uc:ms,Wc(N){nn(N)}})}function TT(c,f){Xn(c>>>=0,{zd:!0,name:f=en(f>>>0),Oc:()=>{},Vc:()=>{}})}function IT(c){Is(c>>>0,!t,1,!n,131072,!1),ed()}var ti=c=>{if(!D)try{if(c(),!(0<St))try{o?ui()&&Ss(b):ls(b)}catch(f){f instanceof Je||f=="unwind"||l(0,f)}}catch(f){f instanceof Je||f=="unwind"||l(0,f)}},ST=!Atomics.waitAsync||globalThis.navigator?.userAgent&&91>Number((navigator.userAgent.match(/Chrom(e|ium)\/([0-9]+)\./)||[])[2]);function gs(c){c>>>=0,ST||(Atomics.waitAsync((T(),w),c>>>2,c).value.then(ni),c+=128,Atomics.store((T(),w),c>>>2,1))}var ni=()=>ti(()=>{var c=ui();c&&(gs(c),Yd())});function $T(c,f){(c>>>=0)==f>>>0?setTimeout(ni):o?postMessage({Zc:c,Sc:"checkMailbox"}):(c=vr[c])&&c.postMessage({Sc:"checkMailbox"})}var bs=[];function AT(c,f,y,m,I){for(f>>>=0,I>>>=0,bs.length=0,y=I>>>3,m=I+m>>>3;y<m;){var P;P=(T(),Z)[y++>>>0]?(T(),Z)[y++>>>0]:(T(),J)[y++>>>0],bs.push(P)}return(f?Ps[f]:y1[c])(...bs)}var OT=()=>{St=0};function PT(c){c>>>=0,o?postMessage({Sc:"cleanupThread",Nd:c}):Qc(vr[c])}function ET(c){}var ri=c=>{try{c()}catch(f){U(f)}};function CT(c){var f=(...y)=>{oi.push(c);try{return c(...y)}finally{D||(oi.pop(),tn&&or===1&&oi.length===0&&(or=0,St+=1,ri(Vp),typeof Fibers<"u"&&Fibers.Zd()))}};return Od.set(c,f),f}var or=0,tn=null,$d=0,oi=[],ys=new Map,Ad=new Map,Od=new Map,DT=0,_s=null,kT=[],Pd=c=>(function(f){if(!D){if(or===0){var y=!1,m=!1;f((I=0)=>{if(!D&&($d=I,y=!0,m)){or=2,ri(()=>Gp(tn)),typeof MainLoop<"u"&&MainLoop.ud&&MainLoop.resume(),I=!1;try{var P=(function(){var Y=(T(),w)[tn+8>>>2>>>0];return Y=Ad.get(Y),Y=Od.get(Y),--St,Y()})()}catch(Y){P=Y,I=!0}var N=!1;if(!tn){var G=_s;G&&(_s=null,(I?G.reject:G.resolve)(P),N=!0)}if(I&&!N)throw P}}),m=!0,y||(or=1,tn=(function(){var I=yo(65548),P=I+12;if((T(),R)[I>>>2>>>0]=P,(T(),R)[I+4>>>2>>>0]=P+65536,P=oi[0],!ys.has(P)){var N=DT++;ys.set(P,N),Ad.set(N,P)}return P=ys.get(P),(T(),w)[I+8>>>2>>>0]=P,I})(),typeof MainLoop<"u"&&MainLoop.ud&&MainLoop.pause(),ri(()=>Bp(tn)))}else or===2?(or=0,ri(Up),nn(tn),tn=null,kT.forEach(ti)):U(`invalid state: ${or}`);return $d}})(f=>{c().then(f)});function NT(c){return c>>>=0,Pd(async()=>{var f=await Ct(c);return Ht(f)})}var ws=[],LT=c=>{var f=ws.length;return ws.push(c),f},RT=(c,f)=>{for(var y=Array(c),m=0;m<c;++m){var I=m,P=(T(),R)[f+4*m>>>2>>>0],N=fs[P];if(N===void 0)throw c=`parameter ${m}`,P=qd(P),f=en(P),nn(P),new qr(`${c} has unknown type ${f}`);y[I]=N}return y},zT=(c,f,y)=>{var m=[];return c=c(m,y),m.length&&((T(),R)[f>>>2>>>0]=Ht(m)),c},MT={},ii=c=>{var f=MT[c];return f===void 0?en(c):f};function BT(c,f,y){var[m,...I]=RT(c,f>>>0);f=m.Vc.bind(m);var P=I.map(Y=>Y.Uc.bind(Y));c--;var N={toValue:Ct};switch(c=P.map((Y,ne)=>{var we=`argFromPtr${ne}`;return N[we]=Y,`${we}(args${ne?"+"+8*ne:""})`}),y){case 0:var G="toValue(handle)";break;case 2:G="new (toValue(handle))";break;case 3:G="";break;case 1:N.getStringOrSymbol=ii,G="toValue(handle)[getStringOrSymbol(methodName)]"}return G+=`(${c})`,m.zd||(N.toReturnWire=f,N.emval_returnValue=zT,G=`return emval_returnValue(toReturnWire, destructorsRef, ${G})`),G=`return function (handle, methodName, destructorsRef, args) {
  ${G}
  }`,y=new Function(Object.keys(N),G)(...Object.values(N)),G=`methodCaller<(${I.map(Y=>Y.name)}) => ${m.name}>`,LT(Object.defineProperty(y,"name",{value:G}))}function VT(c,f){return f>>>=0,(c=Ct(c>>>0))==Ct(f)}function GT(c){return(c>>>=0)?(c=ii(c),Ht(globalThis[c])):Ht(globalThis)}function UT(c){return c=ii(c>>>0),Ht(e[c])}function FT(c,f){return f>>>=0,c=Ct(c>>>0),f=Ct(f),Ht(c[f])}function WT(c){9<(c>>>=0)&&(xr[c+1]+=1)}function Ed(c,f,y,m,I){return ws[c>>>0](f>>>0,y>>>0,m>>>0,I>>>0)}function HT(c,f,y,m,I){return Ed(c>>>0,f>>>0,y>>>0,m>>>0,I>>>0)}function qT(){return Ht([])}function jT(c){c=Ct(c>>>0);for(var f=Array(c.length),y=0;y<c.length;y++)f[y]=c[y];return Ht(f)}function KT(c){return Ht(ii(c>>>0))}function XT(){return Ht({})}function ZT(c){for(var f=Ct(c>>>=0);f.length;){var y=f.pop();f.pop()(y)}hs(c)}function JT(c,f,y){f>>>=0,y>>>=0,c=Ct(c>>>0),f=Ct(f),y=Ct(y),c[f]=y}function YT(c,f){c=-9007199254740992>c||9007199254740992<c?NaN:Number(c),f>>>=0,c=new Date(1e3*c),(T(),w)[f>>>2>>>0]=c.getUTCSeconds(),(T(),w)[f+4>>>2>>>0]=c.getUTCMinutes(),(T(),w)[f+8>>>2>>>0]=c.getUTCHours(),(T(),w)[f+12>>>2>>>0]=c.getUTCDate(),(T(),w)[f+16>>>2>>>0]=c.getUTCMonth(),(T(),w)[f+20>>>2>>>0]=c.getUTCFullYear()-1900,(T(),w)[f+24>>>2>>>0]=c.getUTCDay(),c=(c.getTime()-Date.UTC(c.getUTCFullYear(),0,1,0,0,0,0))/864e5|0,(T(),w)[f+28>>>2>>>0]=c}var Cd=c=>c%4==0&&(c%100!=0||c%400==0),Dd=[0,31,60,91,121,152,182,213,244,274,305,335],kd=[0,31,59,90,120,151,181,212,243,273,304,334];function QT(c,f){c=-9007199254740992>c||9007199254740992<c?NaN:Number(c),f>>>=0,c=new Date(1e3*c),(T(),w)[f>>>2>>>0]=c.getSeconds(),(T(),w)[f+4>>>2>>>0]=c.getMinutes(),(T(),w)[f+8>>>2>>>0]=c.getHours(),(T(),w)[f+12>>>2>>>0]=c.getDate(),(T(),w)[f+16>>>2>>>0]=c.getMonth(),(T(),w)[f+20>>>2>>>0]=c.getFullYear()-1900,(T(),w)[f+24>>>2>>>0]=c.getDay();var y=(Cd(c.getFullYear())?Dd:kd)[c.getMonth()]+c.getDate()-1|0;(T(),w)[f+28>>>2>>>0]=y,(T(),w)[f+36>>>2>>>0]=-60*c.getTimezoneOffset(),y=new Date(c.getFullYear(),6,1).getTimezoneOffset();var m=new Date(c.getFullYear(),0,1).getTimezoneOffset();c=0|(y!=m&&c.getTimezoneOffset()==Math.min(m,y)),(T(),w)[f+32>>>2>>>0]=c}function e1(c){c>>>=0;var f=new Date((T(),w)[c+20>>>2>>>0]+1900,(T(),w)[c+16>>>2>>>0],(T(),w)[c+12>>>2>>>0],(T(),w)[c+8>>>2>>>0],(T(),w)[c+4>>>2>>>0],(T(),w)[c>>>2>>>0],0),y=(T(),w)[c+32>>>2>>>0],m=f.getTimezoneOffset(),I=new Date(f.getFullYear(),6,1).getTimezoneOffset(),P=new Date(f.getFullYear(),0,1).getTimezoneOffset(),N=Math.min(P,I);return 0>y?(T(),w)[c+32>>>2>>>0]=+(I!=P&&N==m):0<y!=(N==m)&&(I=Math.max(P,I),f.setTime(f.getTime()+6e4*((0<y?N:I)-m))),(T(),w)[c+24>>>2>>>0]=f.getDay(),y=(Cd(f.getFullYear())?Dd:kd)[f.getMonth()]+f.getDate()-1|0,(T(),w)[c+28>>>2>>>0]=y,(T(),w)[c>>>2>>>0]=f.getSeconds(),(T(),w)[c+4>>>2>>>0]=f.getMinutes(),(T(),w)[c+8>>>2>>>0]=f.getHours(),(T(),w)[c+12>>>2>>>0]=f.getDate(),(T(),w)[c+16>>>2>>>0]=f.getMonth(),(T(),w)[c+20>>>2>>>0]=f.getYear(),c=f.getTime(),BigInt(isNaN(c)?-1:c/1e3)}function Nd(c,f,y,m,I,P,N){return o?qe(16,1,c,f,y,m,I,P,N):-52}function Ld(c,f,y,m,I,P){if(o)return qe(17,1,c,f,y,m,I,P)}var bo={},t1=()=>performance.timeOrigin+performance.now();function Rd(c,f){if(o)return qe(18,1,c,f);if(bo[c]&&(clearTimeout(bo[c].id),delete bo[c]),!f)return 0;var y=setTimeout(()=>{delete bo[c],ti(()=>Jd(c,performance.timeOrigin+performance.now()))},f);return bo[c]={id:y,Yd:f},0}function n1(c,f,y,m){c>>>=0,f>>>=0,y>>>=0,m>>>=0;var I=new Date().getFullYear(),P=new Date(I,0,1).getTimezoneOffset();I=new Date(I,6,1).getTimezoneOffset();var N=Math.max(P,I);(T(),R)[c>>>2>>>0]=60*N,(T(),w)[f>>>2>>>0]=+(P!=I),c=(f=G=>{var Y=Math.abs(G);return`UTC${0<=G?"-":"+"}${String(Math.floor(Y/60)).padStart(2,"0")}${String(Y%60).padStart(2,"0")}`})(P),f=f(I),I<P?(rr(c,y,17),rr(f,m,17)):(rr(c,m,17),rr(f,y,17))}var r1=()=>Date.now(),o1=1;function i1(c,f,y){if(y>>>=0,!(0<=c&&3>=c))return 28;if(c===0)c=Date.now();else{if(!o1)return 52;c=performance.timeOrigin+performance.now()}return c=Math.round(1e6*c),(T(),Z)[y>>>3>>>0]=BigInt(c),0}var vs=[],zd=(c,f)=>{vs.length=0;for(var y;y=(T(),z)[c++>>>0];){var m=y!=105;f+=(m&=y!=112)&&f%8?4:0,vs.push(y==112?(T(),R)[f>>>2>>>0]:y==106?(T(),Z)[f>>>3>>>0]:y==105?(T(),w)[f>>>2>>>0]:(T(),J)[f>>>3>>>0]),f+=m?8:4}return vs};function a1(c,f,y){return c>>>=0,f=zd(f>>>0,y>>>0),Ps[c](...f)}function s1(c,f,y){return c>>>=0,f=zd(f>>>0,y>>>0),Ps[c](...f)}var u1=()=>{};function l1(c,f){return E(nt(c>>>0,f>>>0))}var c1=()=>{throw St+=1,"unwind"};function d1(){return 4294901760}var p1=()=>navigator.hardwareConcurrency,Tr={},ai=c=>{var f;return(f=/\bwasm-function\[\d+\]:(0x[0-9a-f]+)/.exec(c))?+f[1]:(f=/:(\d+):\d+(?:\)|$)/.exec(c))?2147483648|+f[1]:0},Md=c=>{for(var f of c)(c=ai(f))&&(Tr[c]=f)};function f1(){var c=Error().stack.toString().split(`
`);return c[0]=="Error"&&c.shift(),Md(c),Tr.gd=ai(c[3]),Tr.Jd=c,Tr.gd}function si(c){if(!(c=Tr[c>>>0]))return 0;var f;if(f=/^\s+at .*\.wasm\.(.*) \(.*\)$/.exec(c))c=f[1];else if(f=/^\s+at (.*) \(.*\)$/.exec(c))c=f[1];else{if(!(f=/^(.+?)@/.exec(c)))return 0;c=f[1]}nn(si.hd??0),f=ei(c)+1;var y=yo(f);return y&&rr(c,y,f),si.hd=y,si.hd}function h1(c){c>>>=0;var f=(T(),z).length;if(c<=f||4294901760<c)return!1;for(var y=1;4>=y;y*=2){var m=f*(1+.2/y);m=Math.min(m,c+100663296);e:{m=(Math.min(4294901760,65536*Math.ceil(Math.max(c,m)/65536))-nr.buffer.byteLength+65535)/65536|0;try{nr.grow(m),De();var I=1;break e}catch{}I=void 0}if(I)return!0}return!1}function m1(c,f,y){if(c>>>=0,f>>>=0,Tr.gd==c)var m=Tr.Jd;else(m=Error().stack.toString().split(`
`))[0]=="Error"&&m.shift(),Md(m);for(var I=3;m[I]&&ai(m[I])!=c;)++I;for(c=0;c<y&&m[c+I];++c)(T(),w)[f+4*c>>>2>>>0]=ai(m[c+I]);return c}var xs,Ts={},Bd=()=>{if(!xs){var c,f={USER:"web_user",LOGNAME:"web_user",PATH:"/",PWD:"/",HOME:"/home/web_user",LANG:(globalThis.navigator?.language??"C").replace("-","_")+".UTF-8",_:"./this.program"};for(c in Ts)Ts[c]===void 0?delete f[c]:f[c]=Ts[c];var y=[];for(c in f)y.push(`${c}=${f[c]}`);xs=y}return xs};function Vd(c,f){if(o)return qe(19,1,c,f);c>>>=0,f>>>=0;var y,m=0,I=0;for(y of Bd()){var P=f+m;(T(),R)[c+I>>>2>>>0]=P,m+=rr(y,P,1/0)+1,I+=4}return 0}function Gd(c,f){if(o)return qe(20,1,c,f);c>>>=0,f>>>=0;var y=Bd();for(var m of((T(),R)[c>>>2>>>0]=y.length,c=0,y))c+=ei(m)+1;return(T(),R)[f>>>2>>>0]=c,0}function Ud(c){return o?qe(21,1,c):52}function Fd(c,f,y,m){return o?qe(22,1,c,f,y,m):52}function Wd(c,f,y,m){return o?qe(23,1,c,f,y,m):70}var g1=[null,[],[]];function Hd(c,f,y,m){if(o)return qe(24,1,c,f,y,m);f>>>=0,y>>>=0,m>>>=0;for(var I=0,P=0;P<y;P++){var N=(T(),R)[f>>>2>>>0],G=(T(),R)[f+4>>>2>>>0];f+=8;for(var Y=0;Y<G;Y++){var ne=c,we=(T(),z)[N+Y>>>0],Oe=g1[ne];we===0||we===10?((ne===1?O:E)(ld(Oe)),Oe.length=0):Oe.push(we)}I+=G}return(T(),R)[m>>>2>>>0]=I,0}function b1(c){return c>>>0}o||(function(){for(var c=e.numThreads-1;c--;)nd();st.push(async()=>{var f=(async function(){if(!o)return Promise.all(tr.map(td))})();ke++,await f,--ke==0&&je&&(f=je,je=null,f())})})(),o||(nr=new WebAssembly.Memory({initial:256,maximum:65536,shared:!0}),De()),e.wasmBinary&&(h=e.wasmBinary),e.stackSave=()=>Ie(),e.stackRestore=c=>Te(c),e.stackAlloc=c=>$s(c),e.setValue=function(c,f,y="i8"){switch(y.endsWith("*")&&(y="*"),y){case"i1":case"i8":(T(),W)[c>>>0]=f;break;case"i16":(T(),te)[c>>>1>>>0]=f;break;case"i32":(T(),w)[c>>>2>>>0]=f;break;case"i64":(T(),Z)[c>>>3>>>0]=BigInt(f);break;case"float":(T(),j)[c>>>2>>>0]=f;break;case"double":(T(),J)[c>>>3>>>0]=f;break;case"*":(T(),R)[c>>>2>>>0]=f;break;default:U(`invalid type for setValue: ${y}`)}},e.getValue=function(c,f="i8"){switch(f.endsWith("*")&&(f="*"),f){case"i1":case"i8":return(T(),W)[c>>>0];case"i16":return(T(),te)[c>>>1>>>0];case"i32":return(T(),w)[c>>>2>>>0];case"i64":return(T(),Z)[c>>>3>>>0];case"float":return(T(),j)[c>>>2>>>0];case"double":return(T(),J)[c>>>3>>>0];case"*":return(T(),R)[c>>>2>>>0];default:U(`invalid type for getValue: ${f}`)}},e.UTF8ToString=nt,e.stringToUTF8=rr,e.lengthBytesUTF8=ei;var qd,jd,ui,nn,yo,Is,Kd,Xd,Zd,Ss,Jd,Yd,$e,_o,Qd,Te,$s,Ie,ep,As,tp,np,rp,Os,op,ip,ap,sp,up,lp,cp,dp,pp,fp,hp,mp,gp,bp,yp,_p,wp,vp,xp,Tp,Ip,Sp,$p,Ap,Op,Pp,Ep,Cp,Dp,kp,Np,Lp,Rp,zp,Mp,Bp,Vp,Gp,Up,Zn,y1=[Jo,Jc,id,cd,dd,pd,fd,hd,md,gd,bd,yd,_d,wd,vd,xd,Nd,Ld,Rd,Vd,Gd,Ud,Fd,Wd,Hd],Ps={1003524:(c,f,y,m,I)=>{if(e===void 0||!e.Xc)return 1;if((c=nt(Number(c>>>0))).startsWith("./")&&(c=c.substring(2)),!(c=e.Xc.get(c)))return 2;if(f=Number(f>>>0),y=Number(y>>>0),m=Number(m>>>0),f+y>c.byteLength)return 3;try{let P=c.subarray(f,f+y);switch(I){case 0:(T(),z).set(P,m>>>0);break;case 1:e.Qd?e.Qd(m,P):e.Id(m,P);break;default:return 4}return 0}catch{return 4}},1004348:(c,f,y)=>{e.td(c,(T(),z).subarray(f>>>0,f+y>>>0))},1004412:()=>e.Sd(),1004454:c=>{e.sd(c)},1004491:()=>{e.Bd()},1004522:()=>{e.Cd()},1004551:()=>{e.Gd()},1004576:c=>e.Ad(c),1004609:c=>e.Ed(c),1004641:(c,f,y)=>{e.ed(Number(c),Number(f),Number(y),!0)},1004704:(c,f,y)=>{e.ed(Number(c),Number(f),Number(y))},1004761:()=>typeof wasmOffsetConverter<"u",1004818:c=>{e.$b("Abs",c,void 0)},1004869:c=>{e.$b("Neg",c,void 0)},1004920:c=>{e.$b("Floor",c,void 0)},1004973:c=>{e.$b("Ceil",c,void 0)},1005025:c=>{e.$b("Reciprocal",c,void 0)},1005083:c=>{e.$b("Sqrt",c,void 0)},1005135:c=>{e.$b("Exp",c,void 0)},1005186:c=>{e.$b("Erf",c,void 0)},1005237:c=>{e.$b("Sigmoid",c,void 0)},1005292:(c,f,y)=>{e.$b("HardSigmoid",c,{alpha:f,beta:y})},1005371:c=>{e.$b("Log",c,void 0)},1005422:c=>{e.$b("Sin",c,void 0)},1005473:c=>{e.$b("Cos",c,void 0)},1005524:c=>{e.$b("Tan",c,void 0)},1005575:c=>{e.$b("Asin",c,void 0)},1005627:c=>{e.$b("Acos",c,void 0)},1005679:c=>{e.$b("Atan",c,void 0)},1005731:c=>{e.$b("Sinh",c,void 0)},1005783:c=>{e.$b("Cosh",c,void 0)},1005835:c=>{e.$b("Asinh",c,void 0)},1005888:c=>{e.$b("Acosh",c,void 0)},1005941:c=>{e.$b("Atanh",c,void 0)},1005994:c=>{e.$b("Tanh",c,void 0)},1006046:c=>{e.$b("Not",c,void 0)},1006097:(c,f,y)=>{e.$b("Clip",c,{min:f,max:y})},1006166:c=>{e.$b("Clip",c,void 0)},1006218:(c,f)=>{e.$b("Elu",c,{alpha:f})},1006276:c=>{e.$b("Gelu",c,void 0)},1006328:c=>{e.$b("Relu",c,void 0)},1006380:(c,f)=>{e.$b("LeakyRelu",c,{alpha:f})},1006444:(c,f)=>{e.$b("ThresholdedRelu",c,{alpha:f})},1006514:(c,f)=>{e.$b("Cast",c,{to:f})},1006572:c=>{e.$b("Add",c,void 0)},1006623:c=>{e.$b("Sub",c,void 0)},1006674:c=>{e.$b("Mul",c,void 0)},1006725:c=>{e.$b("Div",c,void 0)},1006776:c=>{e.$b("Pow",c,void 0)},1006827:c=>{e.$b("Equal",c,void 0)},1006880:c=>{e.$b("Greater",c,void 0)},1006935:c=>{e.$b("GreaterOrEqual",c,void 0)},1006997:c=>{e.$b("Less",c,void 0)},1007049:c=>{e.$b("LessOrEqual",c,void 0)},1007108:(c,f,y,m,I)=>{e.$b("ReduceMean",c,{keepDims:!!f,noopWithEmptyAxes:!!y,axes:m?Array.from((T(),w).subarray(Number(m)>>>0,Number(I)>>>0)):[]})},1007283:(c,f,y,m,I)=>{e.$b("ReduceMax",c,{keepDims:!!f,noopWithEmptyAxes:!!y,axes:m?Array.from((T(),w).subarray(Number(m)>>>0,Number(I)>>>0)):[]})},1007457:(c,f,y,m,I)=>{e.$b("ReduceMin",c,{keepDims:!!f,noopWithEmptyAxes:!!y,axes:m?Array.from((T(),w).subarray(Number(m)>>>0,Number(I)>>>0)):[]})},1007631:(c,f,y,m,I)=>{e.$b("ReduceProd",c,{keepDims:!!f,noopWithEmptyAxes:!!y,axes:m?Array.from((T(),w).subarray(Number(m)>>>0,Number(I)>>>0)):[]})},1007806:(c,f,y,m,I)=>{e.$b("ReduceSum",c,{keepDims:!!f,noopWithEmptyAxes:!!y,axes:m?Array.from((T(),w).subarray(Number(m)>>>0,Number(I)>>>0)):[]})},1007980:(c,f,y,m,I)=>{e.$b("ReduceL1",c,{keepDims:!!f,noopWithEmptyAxes:!!y,axes:m?Array.from((T(),w).subarray(Number(m)>>>0,Number(I)>>>0)):[]})},1008153:(c,f,y,m,I)=>{e.$b("ReduceL2",c,{keepDims:!!f,noopWithEmptyAxes:!!y,axes:m?Array.from((T(),w).subarray(Number(m)>>>0,Number(I)>>>0)):[]})},1008326:(c,f,y,m,I)=>{e.$b("ReduceLogSum",c,{keepDims:!!f,noopWithEmptyAxes:!!y,axes:m?Array.from((T(),w).subarray(Number(m)>>>0,Number(I)>>>0)):[]})},1008503:(c,f,y,m,I)=>{e.$b("ReduceSumSquare",c,{keepDims:!!f,noopWithEmptyAxes:!!y,axes:m?Array.from((T(),w).subarray(Number(m)>>>0,Number(I)>>>0)):[]})},1008683:(c,f,y,m,I)=>{e.$b("ReduceLogSumExp",c,{keepDims:!!f,noopWithEmptyAxes:!!y,axes:m?Array.from((T(),w).subarray(Number(m)>>>0,Number(I)>>>0)):[]})},1008863:c=>{e.$b("Where",c,void 0)},1008916:(c,f,y)=>{e.$b("Transpose",c,{perm:f?Array.from((T(),w).subarray(Number(f)>>>0,Number(y)>>>0)):[]})},1009040:(c,f,y,m)=>{e.$b("DepthToSpace",c,{blocksize:f,mode:nt(y),format:m?"NHWC":"NCHW"})},1009173:(c,f,y,m)=>{e.$b("DepthToSpace",c,{blocksize:f,mode:nt(y),format:m?"NHWC":"NCHW"})},1009306:(c,f,y,m,I,P,N,G,Y,ne,we,Oe,We,Ke,ir)=>{e.$b("ConvTranspose",c,{format:Y?"NHWC":"NCHW",autoPad:f,dilations:[y],group:m,kernelShape:[I],pads:[P,N],strides:[G],wIsConst:()=>!!(T(),W)[ne>>>0],outputPadding:we?Array.from((T(),w).subarray(Number(we)>>>0,Number(Oe)>>>0)):[],outputShape:We?Array.from((T(),w).subarray(Number(We)>>>0,Number(Ke)>>>0)):[],activation:nt(ir)})},1009739:(c,f,y,m,I,P,N,G,Y,ne,we,Oe,We,Ke)=>{e.$b("ConvTranspose",c,{format:G?"NHWC":"NCHW",autoPad:f,dilations:Array.from((T(),w).subarray(Number(y)>>>0,(Number(y)>>>0)+2>>>0)),group:m,kernelShape:Array.from((T(),w).subarray(Number(I)>>>0,(Number(I)>>>0)+2>>>0)),pads:Array.from((T(),w).subarray(Number(P)>>>0,(Number(P)>>>0)+4>>>0)),strides:Array.from((T(),w).subarray(Number(N)>>>0,(Number(N)>>>0)+2>>>0)),wIsConst:()=>!!(T(),W)[Y>>>0],outputPadding:ne?Array.from((T(),w).subarray(Number(ne)>>>0,Number(we)>>>0)):[],outputShape:Oe?Array.from((T(),w).subarray(Number(Oe)>>>0,Number(We)>>>0)):[],activation:nt(Ke)})},1010400:(c,f,y,m,I,P,N,G,Y,ne,we,Oe,We,Ke,ir)=>{e.$b("ConvTranspose",c,{format:Y?"NHWC":"NCHW",autoPad:f,dilations:[y],group:m,kernelShape:[I],pads:[P,N],strides:[G],wIsConst:()=>!!(T(),W)[ne>>>0],outputPadding:we?Array.from((T(),w).subarray(Number(we)>>>0,Number(Oe)>>>0)):[],outputShape:We?Array.from((T(),w).subarray(Number(We)>>>0,Number(Ke)>>>0)):[],activation:nt(ir)})},1010833:(c,f,y,m,I,P,N,G,Y,ne,we,Oe,We,Ke)=>{e.$b("ConvTranspose",c,{format:G?"NHWC":"NCHW",autoPad:f,dilations:Array.from((T(),w).subarray(Number(y)>>>0,(Number(y)>>>0)+2>>>0)),group:m,kernelShape:Array.from((T(),w).subarray(Number(I)>>>0,(Number(I)>>>0)+2>>>0)),pads:Array.from((T(),w).subarray(Number(P)>>>0,(Number(P)>>>0)+4>>>0)),strides:Array.from((T(),w).subarray(Number(N)>>>0,(Number(N)>>>0)+2>>>0)),wIsConst:()=>!!(T(),W)[Y>>>0],outputPadding:ne?Array.from((T(),w).subarray(Number(ne)>>>0,Number(we)>>>0)):[],outputShape:Oe?Array.from((T(),w).subarray(Number(Oe)>>>0,Number(We)>>>0)):[],activation:nt(Ke)})},1011494:(c,f)=>{e.$b("GlobalAveragePool",c,{format:f?"NHWC":"NCHW"})},1011585:(c,f,y,m,I,P,N,G,Y,ne,we,Oe,We,Ke)=>{e.$b("AveragePool",c,{format:Ke?"NHWC":"NCHW",auto_pad:f,ceil_mode:y,count_include_pad:m,storage_order:I,dilations:P?Array.from((T(),w).subarray(Number(P)>>>0,Number(N)>>>0)):[],kernel_shape:G?Array.from((T(),w).subarray(Number(G)>>>0,Number(Y)>>>0)):[],pads:ne?Array.from((T(),w).subarray(Number(ne)>>>0,Number(we)>>>0)):[],strides:Oe?Array.from((T(),w).subarray(Number(Oe)>>>0,Number(We)>>>0)):[]})},1012064:(c,f)=>{e.$b("GlobalAveragePool",c,{format:f?"NHWC":"NCHW"})},1012155:(c,f,y,m,I,P,N,G,Y,ne,we,Oe,We,Ke)=>{e.$b("AveragePool",c,{format:Ke?"NHWC":"NCHW",auto_pad:f,ceil_mode:y,count_include_pad:m,storage_order:I,dilations:P?Array.from((T(),w).subarray(Number(P)>>>0,Number(N)>>>0)):[],kernel_shape:G?Array.from((T(),w).subarray(Number(G)>>>0,Number(Y)>>>0)):[],pads:ne?Array.from((T(),w).subarray(Number(ne)>>>0,Number(we)>>>0)):[],strides:Oe?Array.from((T(),w).subarray(Number(Oe)>>>0,Number(We)>>>0)):[]})},1012634:(c,f)=>{e.$b("GlobalMaxPool",c,{format:f?"NHWC":"NCHW"})},1012721:(c,f,y,m,I,P,N,G,Y,ne,we,Oe,We,Ke)=>{e.$b("MaxPool",c,{format:Ke?"NHWC":"NCHW",auto_pad:f,ceil_mode:y,count_include_pad:m,storage_order:I,dilations:P?Array.from((T(),w).subarray(Number(P)>>>0,Number(N)>>>0)):[],kernel_shape:G?Array.from((T(),w).subarray(Number(G)>>>0,Number(Y)>>>0)):[],pads:ne?Array.from((T(),w).subarray(Number(ne)>>>0,Number(we)>>>0)):[],strides:Oe?Array.from((T(),w).subarray(Number(Oe)>>>0,Number(We)>>>0)):[]})},1013196:(c,f)=>{e.$b("GlobalMaxPool",c,{format:f?"NHWC":"NCHW"})},1013283:(c,f,y,m,I,P,N,G,Y,ne,we,Oe,We,Ke)=>{e.$b("MaxPool",c,{format:Ke?"NHWC":"NCHW",auto_pad:f,ceil_mode:y,count_include_pad:m,storage_order:I,dilations:P?Array.from((T(),w).subarray(Number(P)>>>0,Number(N)>>>0)):[],kernel_shape:G?Array.from((T(),w).subarray(Number(G)>>>0,Number(Y)>>>0)):[],pads:ne?Array.from((T(),w).subarray(Number(ne)>>>0,Number(we)>>>0)):[],strides:Oe?Array.from((T(),w).subarray(Number(Oe)>>>0,Number(We)>>>0)):[]})},1013758:(c,f,y,m,I)=>{e.$b("Gemm",c,{alpha:f,beta:y,transA:m,transB:I})},1013862:c=>{e.$b("MatMul",c,void 0)},1013916:(c,f,y,m)=>{e.$b("ArgMax",c,{keepDims:!!f,selectLastIndex:!!y,axis:m})},1014024:(c,f,y,m)=>{e.$b("ArgMin",c,{keepDims:!!f,selectLastIndex:!!y,axis:m})},1014132:(c,f)=>{e.$b("Softmax",c,{axis:f})},1014195:(c,f)=>{e.$b("Concat",c,{axis:f})},1014255:(c,f,y,m,I)=>{e.$b("Split",c,{axis:f,numOutputs:y,splitSizes:m?Array.from((T(),w).subarray(Number(m)>>>0,Number(I)>>>0)):[]})},1014411:c=>{e.$b("Expand",c,void 0)},1014465:(c,f)=>{e.$b("Gather",c,{axis:Number(f)})},1014536:(c,f)=>{e.$b("GatherElements",c,{axis:Number(f)})},1014615:(c,f)=>{e.$b("GatherND",c,{batch_dims:Number(f)})},1014694:(c,f,y,m,I,P,N,G,Y,ne,we)=>{e.$b("Resize",c,{antialias:f,axes:y?Array.from((T(),w).subarray(Number(y)>>>0,Number(m)>>>0)):[],coordinateTransformMode:nt(I),cubicCoeffA:P,excludeOutside:N,extrapolationValue:G,keepAspectRatioPolicy:nt(Y),mode:nt(ne),nearestMode:nt(we)})},1015056:(c,f,y,m,I,P,N)=>{e.$b("Slice",c,{starts:f?Array.from((T(),w).subarray(Number(f)>>>0,Number(y)>>>0)):[],ends:m?Array.from((T(),w).subarray(Number(m)>>>0,Number(I)>>>0)):[],axes:P?Array.from((T(),w).subarray(Number(P)>>>0,Number(N)>>>0)):[]})},1015320:c=>{e.$b("Tile",c,void 0)},1015372:(c,f,y)=>{e.$b("InstanceNormalization",c,{epsilon:f,format:y?"NHWC":"NCHW"})},1015486:(c,f,y)=>{e.$b("InstanceNormalization",c,{epsilon:f,format:y?"NHWC":"NCHW"})},1015600:c=>{e.$b("Range",c,void 0)},1015653:(c,f)=>{e.$b("Einsum",c,{equation:nt(f)})},1015734:(c,f,y,m,I)=>{e.$b("Pad",c,{mode:f,value:y,pads:m?Array.from((T(),w).subarray(Number(m)>>>0,Number(I)>>>0)):[]})},1015877:(c,f,y,m,I,P)=>{e.$b("BatchNormalization",c,{epsilon:f,momentum:y,spatial:!!I,trainingMode:!!m,format:P?"NHWC":"NCHW"})},1016046:(c,f,y,m,I,P)=>{e.$b("BatchNormalization",c,{epsilon:f,momentum:y,spatial:!!I,trainingMode:!!m,format:P?"NHWC":"NCHW"})},1016215:(c,f,y)=>{e.$b("CumSum",c,{exclusive:Number(f),reverse:Number(y)})},1016312:(c,f,y)=>{e.$b("DequantizeLinear",c,{axis:f,blockSize:y})},1016402:(c,f,y,m,I)=>{e.$b("GridSample",c,{align_corners:f,mode:nt(y),padding_mode:nt(m),format:I?"NHWC":"NCHW"})},1016572:(c,f,y,m,I)=>{e.$b("GridSample",c,{align_corners:f,mode:nt(y),padding_mode:nt(m),format:I?"NHWC":"NCHW"})},1016742:(c,f)=>{e.$b("ScatterND",c,{reduction:nt(f)})},1016827:(c,f,y,m,I,P,N,G,Y)=>{e.$b("Attention",c,{numHeads:f,isUnidirectional:y,maskFilterValue:m,scale:I,doRotary:P,qkvHiddenSizes:N?Array.from((T(),w).subarray(Number(G)>>>0,Number(G)+N>>>0)):[],pastPresentShareBuffer:!!Y})},1017099:c=>{e.$b("BiasAdd",c,void 0)},1017154:c=>{e.$b("BiasSplitGelu",c,void 0)},1017215:c=>{e.$b("FastGelu",c,void 0)},1017271:(c,f,y,m,I,P,N,G,Y,ne,we,Oe,We,Ke,ir,Es)=>{e.$b("Conv",c,{format:Oe?"NHWC":"NCHW",auto_pad:f,dilations:y?Array.from((T(),w).subarray(Number(y)>>>0,Number(m)>>>0)):[],group:I,kernel_shape:P?Array.from((T(),w).subarray(Number(P)>>>0,Number(N)>>>0)):[],pads:G?Array.from((T(),w).subarray(Number(G)>>>0,Number(Y)>>>0)):[],strides:ne?Array.from((T(),w).subarray(Number(ne)>>>0,Number(we)>>>0)):[],w_is_const:()=>!!(T(),W)[Number(We)>>>0],activation:nt(Ke),activation_params:ir?Array.from((T(),j).subarray(Number(ir)>>>0,Number(Es)>>>0)):[]})},1017855:c=>{e.$b("Gelu",c,void 0)},1017907:(c,f,y,m,I,P,N,G,Y)=>{e.$b("GroupQueryAttention",c,{numHeads:f,kvNumHeads:y,scale:m,softcap:I,doRotary:P,rotaryInterleaved:N,smoothSoftmax:G,localWindowSize:Y})},1018124:(c,f,y,m)=>{e.$b("LayerNormalization",c,{axis:f,epsilon:y,simplified:!!m})},1018235:(c,f,y,m)=>{e.$b("LayerNormalization",c,{axis:f,epsilon:y,simplified:!!m})},1018346:(c,f,y,m,I,P)=>{e.$b("MatMulNBits",c,{k:f,n:y,accuracyLevel:m,bits:I,blockSize:P})},1018473:(c,f,y,m,I,P)=>{e.$b("MultiHeadAttention",c,{numHeads:f,isUnidirectional:y,maskFilterValue:m,scale:I,doRotary:P})},1018632:(c,f)=>{e.$b("QuickGelu",c,{alpha:f})},1018696:(c,f,y,m,I)=>{e.$b("RotaryEmbedding",c,{interleaved:!!f,numHeads:y,rotaryEmbeddingDim:m,scale:I})},1018835:(c,f,y)=>{e.$b("SkipLayerNormalization",c,{epsilon:f,simplified:!!y})},1018937:(c,f,y)=>{e.$b("SkipLayerNormalization",c,{epsilon:f,simplified:!!y})},1019039:(c,f,y,m)=>{e.$b("GatherBlockQuantized",c,{gatherAxis:f,quantizeAxis:y,blockSize:m})},1019160:c=>{e.Fd(c)},1019194:(c,f)=>e.Hd(Number(c),Number(f),e.Yc.Kd,e.Yc.errors)};function _1(c,f,y){return Pd(async()=>{await e.Dd(Number(c),Number(f),Number(y))})}function w1(){return typeof wasmOffsetConverter<"u"}function v1(c,f,y,m){var I=Ie();try{return dp(c,f,y,m)}catch(P){if(Te(I),P!==P+0)throw P;$e(1,0)}}function x1(c,f,y){var m=Ie();try{return sp(c,f,y)}catch(I){if(Te(m),I!==I+0)throw I;$e(1,0)}}function T1(c){var f=Ie();try{op(c)}catch(y){if(Te(f),y!==y+0)throw y;$e(1,0)}}function I1(c,f){var y=Ie();try{return Os(c,f)}catch(m){if(Te(y),m!==m+0)throw m;$e(1,0)}}function S1(c,f,y){var m=Ie();try{rp(c,f,y)}catch(I){if(Te(m),I!==I+0)throw I;$e(1,0)}}function $1(c,f){var y=Ie();try{pp(c,f)}catch(m){if(Te(y),m!==m+0)throw m;$e(1,0)}}function A1(c,f,y,m,I,P,N){var G=Ie();try{return lp(c,f,y,m,I,P,N)}catch(Y){if(Te(G),Y!==Y+0)throw Y;$e(1,0)}}function O1(c,f,y,m,I,P){var N=Ie();try{ip(c,f,y,m,I,P)}catch(G){if(Te(N),G!==G+0)throw G;$e(1,0)}}function P1(c,f,y,m){var I=Ie();try{cp(c,f,y,m)}catch(P){if(Te(I),P!==P+0)throw P;$e(1,0)}}function E1(c,f,y,m,I){var P=Ie();try{ap(c,f,y,m,I)}catch(N){if(Te(P),N!==N+0)throw N;$e(1,0)}}function C1(c,f,y,m,I,P,N){var G=Ie();try{hp(c,f,y,m,I,P,N)}catch(Y){if(Te(G),Y!==Y+0)throw Y;$e(1,0)}}function D1(c,f,y,m,I,P,N){var G=Ie();try{mp(c,f,y,m,I,P,N)}catch(Y){if(Te(G),Y!==Y+0)throw Y;$e(1,0)}}function k1(c,f,y,m,I,P,N,G){var Y=Ie();try{_p(c,f,y,m,I,P,N,G)}catch(ne){if(Te(Y),ne!==ne+0)throw ne;$e(1,0)}}function N1(c,f,y,m,I){var P=Ie();try{return fp(c,f,y,m,I)}catch(N){if(Te(P),N!==N+0)throw N;$e(1,0)}}function L1(c,f,y){var m=Ie();try{return wp(c,f,y)}catch(I){if(Te(m),I!==I+0)throw I;$e(1,0)}}function R1(c,f,y,m,I,P,N,G){var Y=Ie();try{vp(c,f,y,m,I,P,N,G)}catch(ne){if(Te(Y),ne!==ne+0)throw ne;$e(1,0)}}function z1(c,f,y,m,I,P,N,G,Y,ne,we,Oe){var We=Ie();try{gp(c,f,y,m,I,P,N,G,Y,ne,we,Oe)}catch(Ke){if(Te(We),Ke!==Ke+0)throw Ke;$e(1,0)}}function M1(c,f,y,m,I,P){var N=Ie();try{return bp(c,f,y,m,I,P)}catch(G){if(Te(N),G!==G+0)throw G;$e(1,0)}}function B1(c,f,y){var m=Ie();try{return xp(c,f,y)}catch(I){if(Te(m),I!==I+0)throw I;return $e(1,0),0n}}function V1(c,f,y,m,I,P,N,G,Y){var ne=Ie();try{up(c,f,y,m,I,P,N,G,Y)}catch(we){if(Te(ne),we!==we+0)throw we;$e(1,0)}}function G1(c){var f=Ie();try{return Tp(c)}catch(y){if(Te(f),y!==y+0)throw y;$e(1,0)}}function U1(c,f){var y=Ie();try{return Mp(c,f)}catch(m){if(Te(y),m!==m+0)throw m;return $e(1,0),0n}}function F1(c){var f=Ie();try{return Ip(c)}catch(y){if(Te(f),y!==y+0)throw y;return $e(1,0),0n}}function W1(c,f,y,m){var I=Ie();try{return Ep(c,f,y,m)}catch(P){if(Te(I),P!==P+0)throw P;$e(1,0)}}function H1(c,f,y,m,I){var P=Ie();try{return Cp(c,f,y,m,I)}catch(N){if(Te(P),N!==N+0)throw N;$e(1,0)}}function q1(c,f,y,m,I,P){var N=Ie();try{return Dp(c,f,y,m,I,P)}catch(G){if(Te(N),G!==G+0)throw G;$e(1,0)}}function j1(c,f,y,m,I,P){var N=Ie();try{return kp(c,f,y,m,I,P)}catch(G){if(Te(N),G!==G+0)throw G;$e(1,0)}}function K1(c,f,y,m,I,P,N,G){var Y=Ie();try{return yp(c,f,y,m,I,P,N,G)}catch(ne){if(Te(Y),ne!==ne+0)throw ne;$e(1,0)}}function X1(c,f,y,m,I){var P=Ie();try{return Np(c,f,y,m,I)}catch(N){if(Te(P),N!==N+0)throw N;return $e(1,0),0n}}function Z1(c,f,y,m){var I=Ie();try{return Lp(c,f,y,m)}catch(P){if(Te(I),P!==P+0)throw P;$e(1,0)}}function J1(c,f,y,m){var I=Ie();try{return Rp(c,f,y,m)}catch(P){if(Te(I),P!==P+0)throw P;$e(1,0)}}function Y1(c,f,y,m,I,P,N,G,Y,ne,we,Oe){var We=Ie();try{return zp(c,f,y,m,I,P,N,G,Y,ne,we,Oe)}catch(Ke){if(Te(We),Ke!==Ke+0)throw Ke;$e(1,0)}}function Q1(c,f,y,m,I,P,N,G,Y,ne,we){var Oe=Ie();try{Op(c,f,y,m,I,P,N,G,Y,ne,we)}catch(We){if(Te(Oe),We!==We+0)throw We;$e(1,0)}}function e2(c,f,y,m,I,P,N,G,Y,ne,we,Oe,We,Ke,ir,Es){var o2=Ie();try{Pp(c,f,y,m,I,P,N,G,Y,ne,we,Oe,We,Ke,ir,Es)}catch(Cs){if(Te(o2),Cs!==Cs+0)throw Cs;$e(1,0)}}function t2(c,f,y){var m=Ie();try{return Sp(c,f,y)}catch(I){if(Te(m),I!==I+0)throw I;$e(1,0)}}function n2(c,f,y){var m=Ie();try{return $p(c,f,y)}catch(I){if(Te(m),I!==I+0)throw I;$e(1,0)}}function r2(c,f,y,m){var I=Ie();try{Ap(c,f,y,m)}catch(P){if(Te(I),P!==P+0)throw P;$e(1,0)}}function li(){if(0<ke)je=li;else if(o)_?.(e),fe();else{for(var c=st;0<c.length;)c.shift()(e);0<ke?je=li:(e.calledRun=!0,D||(fe(),_?.(e)))}}return o||(Zn=await ye(),li()),e.PTR_SIZE=4,pe?e:new Promise((c,f)=>{_=c,S=f})}var r3,o3,i_=L(()=>{"use strict";r3=r_,o3=globalThis.self?.name?.startsWith("em-pthread");o3&&r_()});var u_,cc,i3,Pt,l_,lc,a3,s3,c_,u3,a_,d_,s_,p_,_a=L(()=>{"use strict";ya();u_=typeof location>"u"?void 0:location.origin,cc=import.meta.url>"file:"&&import.meta.url<"file;",i3=()=>{if(!!1){if(cc){let r=URL;return new URL(new r("ort.all.bundle.min.mjs",import.meta.url).href,u_).href}return import.meta.url}},Pt=i3(),l_=()=>{if(Pt&&!Pt.startsWith("blob:"))return Pt.substring(0,Pt.lastIndexOf("/")+1)},lc=(r,e)=>{try{let n=e??Pt;return(n?new URL(r,n):new URL(r)).origin===u_}catch{return!1}},a3=(r,e)=>{let n=e??Pt;try{return(n?new URL(r,n):new URL(r)).href}catch{return}},s3=(r,e)=>`${e??"./"}${r}`,c_=async r=>{let n=await(await fetch(r,{credentials:"same-origin"})).blob();return URL.createObjectURL(n)},u3=async r=>(await import(/*webpackIgnore:true*/ /*@vite-ignore*/r)).default,a_=(n_(),Kr(t_)).default,d_=async()=>{if(!Pt)throw new Error("Failed to load proxy worker: cannot determine the script source URL.");if(lc(Pt))return[void 0,a_()];let r=await c_(Pt);return[r,a_(r)]},s_=(i_(),Kr(o_)).default,p_=async(r,e,n,t)=>{let o=s_&&!(r||e);if(o)if(Pt)o=lc(Pt)||t&&!n;else if(t&&!n)o=!0;else throw new Error("cannot determine the script source URL.");if(o)return[void 0,s_];{let i="ort-wasm-simd-threaded.jsep.mjs",a=r??a3(i,e),s=!!1&&n&&a&&!lc(a,e),u=s?await c_(a):a??s3(i,e);return[s?u:void 0,await u3(u)]}}});var dc,pc,Oa,f_,l3,c3,d3,wa,Ve,gr=L(()=>{"use strict";_a();pc=!1,Oa=!1,f_=!1,l3=()=>{if(typeof SharedArrayBuffer>"u")return!1;try{return typeof MessageChannel<"u"&&new MessageChannel().port1.postMessage(new SharedArrayBuffer(1)),WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,5,4,1,3,1,1,10,11,1,9,0,65,0,254,16,2,0,26,11]))}catch{return!1}},c3=()=>{try{return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,10,30,1,28,0,65,0,253,15,253,12,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,253,186,1,26,11]))}catch{return!1}},d3=()=>{try{return WebAssembly.validate(new Uint8Array([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,19,1,17,0,65,1,253,15,65,2,253,15,65,3,253,15,253,147,2,11]))}catch{return!1}},wa=async r=>{if(pc)return Promise.resolve();if(Oa)throw new Error("multiple calls to 'initializeWebAssembly()' detected.");if(f_)throw new Error("previous call to 'initializeWebAssembly()' failed.");Oa=!0;let e=r.initTimeout,n=r.numThreads;if(r.simd!==!1){if(r.simd==="relaxed"){if(!d3())throw new Error("Relaxed WebAssembly SIMD is not supported in the current environment.")}else if(!c3())throw new Error("WebAssembly SIMD is not supported in the current environment.")}let t=l3();n>1&&!t&&(typeof self<"u"&&!self.crossOriginIsolated&&console.warn("env.wasm.numThreads is set to "+n+", but this will not work unless you enable crossOriginIsolated mode. See https://web.dev/cross-origin-isolation-guide/ for more info."),console.warn("WebAssembly multi-threading is not supported in the current environment. Falling back to single-threading."),r.numThreads=n=1);let o=r.wasmPaths,i=typeof o=="string"?o:void 0,a=o?.mjs,s=a?.href??a,u=o?.wasm,l=u?.href??u,d=r.wasmBinary,[p,h]=await p_(s,i,n>1,!!d||!!l),g=!1,b=[];if(e>0&&b.push(new Promise(_=>{setTimeout(()=>{g=!0,_()},e)})),b.push(new Promise((_,S)=>{let v={numThreads:n};if(d)v.wasmBinary=d,v.locateFile=x=>x;else if(l||i)v.locateFile=x=>l??i+x;else if(s&&s.indexOf("blob:")!==0)v.locateFile=x=>new URL(x,s).href;else if(p){let x=l_();x&&(v.locateFile=$=>x+$)}h(v).then(x=>{Oa=!1,pc=!0,dc=x,_(),p&&URL.revokeObjectURL(p)},x=>{Oa=!1,f_=!0,S(x)})})),await Promise.race(b),g)throw new Error(`WebAssembly backend initializing failed due to timeout: ${e}ms`)},Ve=()=>{if(pc&&dc)return dc;throw new Error("WebAssembly is not initialized yet.")}});var Et,Uo,Ee,Pa=L(()=>{"use strict";gr();Et=(r,e)=>{let n=Ve(),t=n.lengthBytesUTF8(r)+1,o=n._malloc(t);return n.stringToUTF8(r,o,t),e.push(o),o},Uo=(r,e,n,t)=>{if(typeof r=="object"&&r!==null){if(n.has(r))throw new Error("Circular reference in options");n.add(r)}Object.entries(r).forEach(([o,i])=>{let a=e?e+o:o;if(typeof i=="object")Uo(i,a+".",n,t);else if(typeof i=="string"||typeof i=="number")t(a,i.toString());else if(typeof i=="boolean")t(a,i?"1":"0");else throw new Error(`Can't handle extra config type: ${typeof i}`)})},Ee=r=>{let e=Ve(),n=e.stackSave();try{let t=e.PTR_SIZE,o=e.stackAlloc(2*t);e._OrtGetLastError(o,o+t);let i=Number(e.getValue(o,t===4?"i32":"i64")),a=e.getValue(o+t,"*"),s=a?e.UTF8ToString(a):"";throw new Error(`${r} ERROR_CODE: ${i}, ERROR_MESSAGE: ${s}`)}finally{e.stackRestore(n)}}});var h_,m_=L(()=>{"use strict";gr();Pa();h_=r=>{let e=Ve(),n=0,t=[],o=r||{};try{if(r?.logSeverityLevel===void 0)o.logSeverityLevel=2;else if(typeof r.logSeverityLevel!="number"||!Number.isInteger(r.logSeverityLevel)||r.logSeverityLevel<0||r.logSeverityLevel>4)throw new Error(`log severity level is not valid: ${r.logSeverityLevel}`);if(r?.logVerbosityLevel===void 0)o.logVerbosityLevel=0;else if(typeof r.logVerbosityLevel!="number"||!Number.isInteger(r.logVerbosityLevel))throw new Error(`log verbosity level is not valid: ${r.logVerbosityLevel}`);r?.terminate===void 0&&(o.terminate=!1);let i=0;return r?.tag!==void 0&&(i=Et(r.tag,t)),n=e._OrtCreateRunOptions(o.logSeverityLevel,o.logVerbosityLevel,!!o.terminate,i),n===0&&Ee("Can't create run options."),r?.extra!==void 0&&Uo(r.extra,"",new WeakSet,(a,s)=>{let u=Et(a,t),l=Et(s,t);e._OrtAddRunConfigEntry(n,u,l)!==0&&Ee(`Can't set a run config entry: ${a} - ${s}.`)}),[n,t]}catch(i){throw n!==0&&e._OrtReleaseRunOptions(n),t.forEach(a=>e._free(a)),i}}});var p3,f3,h3,uo,m3,g_,b_=L(()=>{"use strict";gr();Pa();p3=r=>{switch(r){case"disabled":return 0;case"basic":return 1;case"extended":return 2;case"layout":return 3;case"all":return 99;default:throw new Error(`unsupported graph optimization level: ${r}`)}},f3=r=>{switch(r){case"sequential":return 0;case"parallel":return 1;default:throw new Error(`unsupported execution mode: ${r}`)}},h3=r=>{r.extra||(r.extra={}),r.extra.session||(r.extra.session={});let e=r.extra.session;e.use_ort_model_bytes_directly||(e.use_ort_model_bytes_directly="1"),r.executionProviders&&r.executionProviders.some(n=>(typeof n=="string"?n:n.name)==="webgpu")&&(r.enableMemPattern=!1)},uo=(r,e,n,t)=>{let o=Et(e,t),i=Et(n,t);Ve()._OrtAddSessionConfigEntry(r,o,i)!==0&&Ee(`Can't set a session config entry: ${e} - ${n}.`)},m3=async(r,e,n)=>{let t=e.executionProviders;for(let o of t){let i=typeof o=="string"?o:o.name,a=[];switch(i){case"webnn":if(i="WEBNN",uo(r,"session.disable_quant_qdq","1",n),uo(r,"session.disable_qdq_constant_folding","1",n),typeof o!="string"){let h=o?.deviceType;h&&uo(r,"deviceType",h,n)}break;case"webgpu":if(i="JS",typeof o!="string"){let p=o;if(p?.preferredLayout){if(p.preferredLayout!=="NCHW"&&p.preferredLayout!=="NHWC")throw new Error(`preferredLayout must be either 'NCHW' or 'NHWC': ${p.preferredLayout}`);uo(r,"preferredLayout",p.preferredLayout,n)}}break;case"wasm":case"cpu":continue;default:throw new Error(`not supported execution provider: ${i}`)}let s=Et(i,n),u=a.length,l=0,d=0;if(u>0){l=Ve()._malloc(u*Ve().PTR_SIZE),n.push(l),d=Ve()._malloc(u*Ve().PTR_SIZE),n.push(d);for(let p=0;p<u;p++)Ve().setValue(l+p*Ve().PTR_SIZE,a[p][0],"*"),Ve().setValue(d+p*Ve().PTR_SIZE,a[p][1],"*")}await Ve()._OrtAppendExecutionProvider(r,s,l,d,u)!==0&&Ee(`Can't append execution provider: ${i}.`)}},g_=async r=>{let e=Ve(),n=0,t=[],o=r||{};h3(o);try{let i=p3(o.graphOptimizationLevel??"all"),a=f3(o.executionMode??"sequential"),s=typeof o.logId=="string"?Et(o.logId,t):0,u=o.logSeverityLevel??2;if(!Number.isInteger(u)||u<0||u>4)throw new Error(`log severity level is not valid: ${u}`);let l=o.logVerbosityLevel??0;if(!Number.isInteger(l)||l<0||l>4)throw new Error(`log verbosity level is not valid: ${l}`);let d=typeof o.optimizedModelFilePath=="string"?Et(o.optimizedModelFilePath,t):0;if(n=e._OrtCreateSessionOptions(i,!!o.enableCpuMemArena,!!o.enableMemPattern,a,!!o.enableProfiling,0,s,u,l,d),n===0&&Ee("Can't create session options."),o.executionProviders&&await m3(n,o,t),o.enableGraphCapture!==void 0){if(typeof o.enableGraphCapture!="boolean")throw new Error(`enableGraphCapture must be a boolean value: ${o.enableGraphCapture}`);uo(n,"enableGraphCapture",o.enableGraphCapture.toString(),t)}if(o.freeDimensionOverrides)for(let[p,h]of Object.entries(o.freeDimensionOverrides)){if(typeof p!="string")throw new Error(`free dimension override name must be a string: ${p}`);if(typeof h!="number"||!Number.isInteger(h)||h<0)throw new Error(`free dimension override value must be a non-negative integer: ${h}`);let g=Et(p,t);e._OrtAddFreeDimensionOverride(n,g,h)!==0&&Ee(`Can't set a free dimension override: ${p} - ${h}.`)}return o.extra!==void 0&&Uo(o.extra,"",new WeakSet,(p,h)=>{uo(n,p,h,t)}),[n,t]}catch(i){throw n!==0&&e._OrtReleaseSessionOptions(n)!==0&&Ee("Can't release session options."),t.forEach(a=>e._free(a)),i}}});var br,Gn,yr,lo,Fo,Ea,Ca,fc,ce=L(()=>{"use strict";br=r=>{switch(r){case"int8":return 3;case"uint8":return 2;case"bool":return 9;case"int16":return 5;case"uint16":return 4;case"int32":return 6;case"uint32":return 12;case"float16":return 10;case"float32":return 1;case"float64":return 11;case"string":return 8;case"int64":return 7;case"uint64":return 13;case"int4":return 22;case"uint4":return 21;default:throw new Error(`unsupported data type: ${r}`)}},Gn=r=>{switch(r){case 3:return"int8";case 2:return"uint8";case 9:return"bool";case 5:return"int16";case 4:return"uint16";case 6:return"int32";case 12:return"uint32";case 10:return"float16";case 1:return"float32";case 11:return"float64";case 8:return"string";case 7:return"int64";case 13:return"uint64";case 22:return"int4";case 21:return"uint4";default:throw new Error(`unsupported data type: ${r}`)}},yr=(r,e)=>{let n=[-1,4,1,1,2,2,4,8,-1,1,2,8,4,8,-1,-1,-1,-1,-1,-1,-1,.5,.5][r],t=typeof e=="number"?e:e.reduce((o,i)=>o*i,1);return n>0?Math.ceil(t*n):void 0},lo=r=>{switch(r){case"float16":return typeof Float16Array<"u"?Float16Array:Uint16Array;case"float32":return Float32Array;case"uint8":return Uint8Array;case"int8":return Int8Array;case"uint16":return Uint16Array;case"int16":return Int16Array;case"int32":return Int32Array;case"bool":return Uint8Array;case"float64":return Float64Array;case"uint32":return Uint32Array;case"int64":return BigInt64Array;case"uint64":return BigUint64Array;default:throw new Error(`unsupported type: ${r}`)}},Fo=r=>{switch(r){case"verbose":return 0;case"info":return 1;case"warning":return 2;case"error":return 3;case"fatal":return 4;default:throw new Error(`unsupported logging level: ${r}`)}},Ea=r=>r==="float32"||r==="float16"||r==="int32"||r==="int64"||r==="uint32"||r==="uint8"||r==="bool"||r==="uint4"||r==="int4",Ca=r=>r==="float32"||r==="float16"||r==="int32"||r==="int64"||r==="uint32"||r==="uint64"||r==="int8"||r==="uint8"||r==="bool"||r==="uint4"||r==="int4",fc=r=>{switch(r){case"none":return 0;case"cpu":return 1;case"cpu-pinned":return 2;case"texture":return 3;case"gpu-buffer":return 4;case"ml-tensor":return 5;default:throw new Error(`unsupported data location: ${r}`)}}});var Wo,hc=L(()=>{"use strict";ya();Wo=async r=>{if(typeof r=="string")if(!1)try{let{readFile:e}=jr("node:fs/promises");return new Uint8Array(await e(r))}catch(e){if(e.code==="ERR_FS_FILE_TOO_LARGE"){let{createReadStream:n}=jr("node:fs"),t=n(r),o=[];for await(let i of t)o.push(i);return new Uint8Array(Buffer.concat(o))}throw e}else{let e=await fetch(r);if(!e.ok)throw new Error(`failed to load external data file: ${r}`);let n=e.headers.get("Content-Length"),t=n?parseInt(n,10):0;if(t<1073741824)return new Uint8Array(await e.arrayBuffer());{if(!e.body)throw new Error(`failed to load external data file: ${r}, no response body.`);let o=e.body.getReader(),i;try{i=new ArrayBuffer(t)}catch(s){if(s instanceof RangeError){let u=Math.ceil(t/65536);i=new WebAssembly.Memory({initial:u,maximum:u}).buffer}else throw s}let a=0;for(;;){let{done:s,value:u}=await o.read();if(s)break;let l=u.byteLength;new Uint8Array(i,a,l).set(u),a+=l}return new Uint8Array(i,0,t)}}else return r instanceof Blob?new Uint8Array(await r.arrayBuffer()):r instanceof Uint8Array?r:new Uint8Array(r)}});var g3,b3,y_,__,Da,y3,_e,Un=L(()=>{"use strict";ce();g3=["V","I","W","E","F"],b3=(r,e)=>{console.log(`[${g3[r]},${new Date().toISOString()}]${e}`)},Da=(r,e)=>{y_=r,__=e},y3=(r,e)=>{let n=Fo(r),t=Fo(y_);n>=t&&b3(n,typeof e=="function"?e():e)},_e=(...r)=>{__&&y3(...r)}});var mc,Fn,k,Vr,ka,w_,v_,me=L(()=>{"use strict";mc=class{static calcMatMulShape(e,n){return e[1]!==n[0]?void 0:[e[0],n[1]]}},Fn=class{static calcShape(e,n,t=!1){let o=e.length,i=n.length;if(o===0)return n;if(i===0)return e;let a=Math.max(e.length,n.length),s=new Array(a);if(t){if(o<2||i<2)return;let u=mc.calcMatMulShape([e[o-2],e[o-1]],[n[i-2],n[i-1]]);if(u===void 0)return;[s[a-2],s[a-1]]=u}for(let u=t?3:1;u<=a;u++){let l=o-u<0?1:e[o-u],d=i-u<0?1:n[i-u];if(l!==d&&l>1&&d>1)return;let p=Math.max(l,d);if(l&&d)s[a-u]=Math.max(l,d);else{if(p>1)return;s[a-u]=0}}return s}static isValidBroadcast(e,n){let t=e.length,o=n.length;if(t>o)return!1;for(let i=1;i<=t;i++)if(e[t-i]!==1&&e[t-i]!==n[o-i])return!1;return!0}},k=class r{static size(e){return r.getSizeFromDimensionRange(e,0,e.length)}static convertShape(e,n=4){let t=e.length;if(t===0)return[];let o=new Array(t),i=t-1;for(;i>=0;){if(e[i]%n===0){o[i]=e[i]/n;break}if(n%e[i]!==0)throw new Error("cannot convert shape");o[i]=1,n/=e[i],i--}for(i--;i>=0;i--)o[i]=e[i];return o}static sizeFromDimension(e,n){if(n<0||n>e.length)throw new Error(`invalid dimension of ${n} for sizeFromDimension as Tensor has ${e.length} dimensions.`);return r.getSizeFromDimensionRange(e,n,e.length)}static sizeToDimension(e,n){if(n<0||n>e.length)throw new Error(`invalid dimension of ${n} for sizeToDimension as Tensor has ${e.length} dimensions.`);return r.getSizeFromDimensionRange(e,0,n)}static getSizeFromDimensionRange(e,n,t){let o=1;for(let i=n;i<t;i++){if(e[i]<0)throw new Error("cannot get valid size from specified dimension range. Most likely the range contains negative values in them.");o*=Number(e[i])}return o}static computeStrides(e){let n=e.length;if(n===0)return[];if(n===1)return[1];let t=new Array(n);t[n-1]=1,t[n-2]=e[n-1];for(let o=n-3;o>=0;--o)t[o]=t[o+1]*e[o+1];return t}static normalizeAxis(e,n){if(e<-n&&e>=n)throw new Error("unsupported axis for this operation.");return e<0?e+n:e}static normalizeAxes(e,n){return e.map(t=>this.normalizeAxis(t,n??e.length))}static sortBasedOnPerm(e,n){return n?n.map(t=>e[t]):e.slice().reverse()}static padShape(e,n){let t=e.length;return e.map((o,i)=>o+n[i]+n[i+t])}static areEqual(e,n){return e.length!==n.length?!1:e.every((t,o)=>t===n[o])}},Vr=class r{static adjustPoolAttributes(e,n,t,o,i,a){if(!e&&t.length!==n.length-2)throw new Error("length of specified kernel shapes should be 2 less than length of input dimensions");if(e)for(let s=0;s<n.length-2;s++)s>=t.length?t.push(n[s+2]):t[s]=n[s+2];for(let s=0;s<t.length;s++)if(s<o.length){if(o[s]<0)throw new Error("strides should be greater than or equal to 1")}else o.push(1);for(let s=0;s<t.length;s++)if(s<i.length){if(i[s]<0)throw new Error("dilations should be greater than or equal to 1")}else i.push(1);for(let s=0;s<t.length*2;s++)if(s<a.length){if(a[s]<0)throw new Error("pad should be greater than or equal to 1")}else a.push(0);for(let s=0;s<t.length;s++){if(t[s]<=0)throw new Error("kernel shapes need to be greater than 0");if(a[s]>=t[s]||a[s+t.length]>=t[s])throw new Error("pads should be smaller than kernel")}}static adjustPadsBasedOnAutoPad(e,n,t,o,i,a,s){if(s){if(i.length!==2*(e.length-2))throw new Error("length of pads should be twice the length of data dimensions");if(n.length!==e.length-2)throw new Error("length of strides should be the length of data dimensions");if(o.length!==e.length-2)throw new Error("length of kernel shapes should be the length of data dimensions");for(let u=0;u<e.length-2;u++)r.adjustPadAndReturnShape(e[u+(a?1:2)],n[u],t[u],o[u],i,u,u+e.length-2,s)}}static computePoolOutputShape(e,n,t,o,i,a,s){if(n.length<=0)throw new Error("input shape must be of size greater than 0");let u=[n[0],n[1]];return r.computeShapeHelper(e,n,u,t,o,i,a,s),u}static computeConvOutputShape(e,n,t,o,i,a,s){if(e.length<=0||n.length<=0)throw new Error("invalid input tensor dims or invalid filter tensor dims");let u=[e[0],n[0]];return r.computeShapeHelper(!1,e,u,t,o,i,a,s),u}static computeShapeHelper(e,n,t,o,i,a,s,u){if(e)for(let l=0;l<n.length-2;l++)t.push(1);else for(let l=0;l<n.length-2;l++)t.push(r.adjustPadAndReturnShape(n[l+2],o[l],i[l],a[l],s,l,l+n.length-2,u))}static adjustPadAndReturnShape(e,n,t,o,i,a,s,u){let l=t*(o-1)+1;if(u&&u!=="NOTSET")switch(u){case"VALID":return i[a]=0,i[s]=0,Math.floor((e-l)/n+1);case"SAME_LOWER":case"SAME_UPPER":if(t!==1)throw new Error("Dilation not supported for SAME_UPPER or SAME_LOWER");{let p=((e+n-1)/n-1)*n+o-e;return i[a]=Math.floor(u==="SAME_LOWER"?(p+1)/2:p/2),i[s]=p-i[a],Math.floor((e+p-o)/n+1)}default:throw new Error("Unsupported AutoPad type")}else return Math.floor((e+i[a]+i[s]-l)/n+1)}},ka=class{static getShapeOfGemmResult(e,n,t,o,i){if(e.length!==2||t.length!==2)throw new Error("shape need to be of size 2");let a,s,u;n?(a=e[1],s=e[0]):(a=e[0],s=e[1]);let l=-1;if(o?(u=t[0],l=1):(u=t[1],l=0),t[l]!==s)throw new Error("dimension mismatch");if(a<=0||u<=0||s<=0)throw new Error("invalid shape specified");if(i&&!Fn.isValidBroadcast(i,[a,u]))throw new Error("gemm: invalid bias shape for broadcast");return[a,u,s]}},w_=-34028234663852886e22,v_=34028234663852886e22});var Na,gc=L(()=>{"use strict";ce();Na=(r,e)=>new(lo(e))(r)});var T_,yc,I_,_3,x_,w3,S_,La,Ra,bc,$_,A_=L(()=>{"use strict";ce();Un();T_=new Map([["float32",32],["float16",16],["int32",32],["uint32",32],["int64",64],["uint64",64],["int8",8],["uint8",8],["int4",4],["uint4",4]]),yc=(r,e)=>{if(e==="int32")return r;let n=T_.get(e);if(!n)throw new Error(`WebNN backend does not support data type: ${e}`);let t=n/8;if(r.byteLength%t!==0)throw new Error(`Invalid Uint8Array length - must be a multiple of ${t}.`);let o=r.byteLength/t,i=new(lo(e))(r.buffer,r.byteOffset,o);switch(e){case"int64":case"uint64":{let a=new Int32Array(o);for(let s=0;s<o;s++){let u=i[s];if(u>2147483647n||u<-2147483648n)throw new Error("Can not convert int64 data to int32 - value out of range.");a[s]=Number(u)}return new Uint8Array(a.buffer)}case"int8":case"uint8":case"uint32":{if(e==="uint32"&&i.some(s=>s>2147483647))throw new Error("Can not convert uint32 data to int32 - value out of range.");let a=Int32Array.from(i,Number);return new Uint8Array(a.buffer)}default:throw new Error(`Unsupported data conversion from ${e} to 'int32'`)}},I_=(r,e)=>{if(e==="int32")return r;if(r.byteLength%4!==0)throw new Error("Invalid Uint8Array length - must be a multiple of 4 (int32).");let n=r.byteLength/4,t=new Int32Array(r.buffer,r.byteOffset,n);switch(e){case"int64":{let o=BigInt64Array.from(t,BigInt);return new Uint8Array(o.buffer)}case"uint64":{if(t.some(i=>i<0))throw new Error("Can not convert int32 data to uin64 - negative value found.");let o=BigUint64Array.from(t,BigInt);return new Uint8Array(o.buffer)}case"int8":{if(t.some(i=>i<-128||i>127))throw new Error("Can not convert int32 data to int8 - value out of range.");let o=Int8Array.from(t,Number);return new Uint8Array(o.buffer)}case"uint8":{if(t.some(o=>o<0||o>255))throw new Error("Can not convert int32 data to uint8 - value out of range.");return Uint8Array.from(t,Number)}case"uint32":{if(t.some(i=>i<0))throw new Error("Can not convert int32 data to uint32 - negative value found.");let o=Uint32Array.from(t,Number);return new Uint8Array(o.buffer)}default:throw new Error(`Unsupported data conversion from 'int32' to ${e}`)}},_3=1,x_=()=>_3++,w3=new Map([["int8","int32"],["uint8","int32"],["uint32","int32"],["int64","int32"]]),S_=(r,e)=>{let n=T_.get(r);if(!n)throw new Error(`WebNN backend does not support data type: ${r}`);return e.length>0?Math.ceil(e.reduce((t,o)=>t*o)*n/8):0},La=class{constructor(e){this.isDataConverted=!1;let{sessionId:n,context:t,tensor:o,dataType:i,shape:a,fallbackDataType:s}=e;this.sessionId=n,this.mlContext=t,this.mlTensor=o,this.dataType=i,this.tensorShape=a,this.fallbackDataType=s}get tensor(){return this.mlTensor}get type(){return this.dataType}get fallbackType(){return this.fallbackDataType}get shape(){return this.tensorShape}get byteLength(){return S_(this.dataType,this.tensorShape)}destroy(){_e("verbose",()=>"[WebNN] TensorWrapper.destroy"),this.mlTensor.destroy()}write(e){this.mlContext.writeTensor(this.mlTensor,e)}async read(e){if(this.fallbackDataType){let n=await this.mlContext.readTensor(this.mlTensor),t=I_(new Uint8Array(n),this.dataType);if(e){(e instanceof ArrayBuffer?new Uint8Array(e):new Uint8Array(e.buffer,e.byteOffset,e.byteLength)).set(t);return}else return new Uint8Array(t).buffer}else return e?this.mlContext.readTensor(this.mlTensor,e):this.mlContext.readTensor(this.mlTensor)}canReuseTensor(e,n,t){return this.mlContext===e&&this.dataType===n&&this.tensorShape.length===t.length&&this.tensorShape.every((o,i)=>o===t[i])}setIsDataConverted(e){this.isDataConverted=e}},Ra=class{constructor(e,n){this.tensorManager=e;this.wrapper=n}get tensorWrapper(){return this.wrapper}releaseTensor(){this.tensorWrapper&&(this.tensorManager.releaseTensor(this.tensorWrapper),this.wrapper=void 0)}async ensureTensor(e,n,t,o){let i=this.tensorManager.getMLContext(e),a=this.tensorManager.getMLOpSupportLimits(e),s;if(!a?.input.dataTypes.includes(n)){if(s=w3.get(n),!s||a?.input.dataTypes.includes(s))throw new Error(`WebNN backend does not support data type: ${n}`);_e("verbose",()=>`[WebNN] TensorIdTracker.ensureTensor: fallback dataType from ${n} to ${s}`)}if(this.wrapper){if(this.wrapper.canReuseTensor(i,n,t))return this.wrapper.tensor;if(o){if(this.wrapper.byteLength!==S_(n,t))throw new Error("Unable to copy data to tensor with different size.");this.activeUpload=new Uint8Array(await this.wrapper.read())}this.tensorManager.releaseTensor(this.wrapper)}let u=typeof MLTensorUsage>"u"?void 0:MLTensorUsage.READ|MLTensorUsage.WRITE;return this.wrapper=await this.tensorManager.getCachedTensor(e,n,t,u,!0,!0,s),o&&this.activeUpload&&(this.wrapper.write(this.activeUpload),this.activeUpload=void 0),this.wrapper.tensor}upload(e){let n=e;if(this.wrapper){if(this.wrapper.fallbackType)if(this.wrapper.fallbackType==="int32")n=yc(e,this.wrapper.type),this.wrapper.setIsDataConverted(!0);else throw new Error(`Unsupported fallback data type: ${this.wrapper.fallbackType}`);if(e.byteLength===this.wrapper.byteLength){this.wrapper.write(n);return}else _e("verbose",()=>"Data size does not match tensor size. Releasing tensor."),this.releaseTensor()}this.activeUpload?this.activeUpload.set(n):this.activeUpload=new Uint8Array(n)}async download(e){if(this.activeUpload){let n=this.wrapper?.isDataConverted?I_(this.activeUpload,this.wrapper?.type):this.activeUpload;if(e){e instanceof ArrayBuffer?new Uint8Array(e).set(n):new Uint8Array(e.buffer,e.byteOffset,e.byteLength).set(n);return}else return n.buffer}if(!this.wrapper)throw new Error("Tensor has not been created.");return e?this.wrapper.read(e):this.wrapper.read()}},bc=class{constructor(e){this.backend=e;this.tensorTrackersById=new Map;this.freeTensors=[];this.externalTensors=new Set}getMLContext(e){let n=this.backend.getMLContext(e);if(!n)throw new Error("MLContext not found for session.");return n}getMLOpSupportLimits(e){return this.backend.getMLOpSupportLimits(e)}reserveTensorId(){let e=x_();return this.tensorTrackersById.set(e,new Ra(this)),e}releaseTensorId(e){let n=this.tensorTrackersById.get(e);n&&(this.tensorTrackersById.delete(e),n.tensorWrapper&&this.releaseTensor(n.tensorWrapper))}async ensureTensor(e,n,t,o,i){_e("verbose",()=>`[WebNN] TensorManager.ensureTensor {tensorId: ${n}, dataType: ${t}, shape: ${o}, copyOld: ${i}}`);let a=this.tensorTrackersById.get(n);if(!a)throw new Error("Tensor not found.");return a.ensureTensor(e,t,o,i)}upload(e,n){let t=this.tensorTrackersById.get(e);if(!t)throw new Error("Tensor not found.");t.upload(n)}async download(e,n){_e("verbose",()=>`[WebNN] TensorManager.download {tensorId: ${e}, dstBuffer: ${n?.byteLength}}`);let t=this.tensorTrackersById.get(e);if(!t)throw new Error("Tensor not found.");return t.download(n)}releaseTensorsForSession(e){for(let n of this.freeTensors)n.sessionId===e&&n.destroy();this.freeTensors=this.freeTensors.filter(n=>n.sessionId!==e)}registerTensor(e,n,t,o){let i=this.getMLContext(e),a=x_(),s=new La({sessionId:e,context:i,tensor:n,dataType:t,shape:o});return this.tensorTrackersById.set(a,new Ra(this,s)),this.externalTensors.add(s),a}async getCachedTensor(e,n,t,o,i,a,s){let u=this.getMLContext(e);for(let[d,p]of this.freeTensors.entries())if(p.canReuseTensor(u,n,t)){_e("verbose",()=>`[WebNN] Reusing tensor {dataType: ${n}, ${s?`fallbackDataType: ${s},`:""} shape: ${t}`);let h=this.freeTensors.splice(d,1)[0];return h.sessionId=e,h}_e("verbose",()=>`[WebNN] MLContext.createTensor {dataType: ${n}, ${s?`fallbackDataType: ${s},`:""} shape: ${t}}`);let l=await u.createTensor({dataType:s??n,shape:t,dimensions:t,usage:o,writable:i,readable:a});return new La({sessionId:e,context:u,tensor:l,dataType:n,shape:t,fallbackDataType:s})}releaseTensor(e){this.externalTensors.has(e)&&this.externalTensors.delete(e),this.freeTensors.push(e)}},$_=(...r)=>new bc(...r)});var za,v3,Ma,O_=L(()=>{"use strict";ce();gr();gc();A_();Un();za=new Map([[1,"float32"],[10,"float16"],[6,"int32"],[12,"uint32"],[7,"int64"],[13,"uint64"],[22,"int4"],[21,"uint4"],[3,"int8"],[2,"uint8"],[9,"uint8"]]),v3=(r,e)=>{if(r===e)return!0;if(r===void 0||e===void 0)return!1;let n=Object.keys(r).sort(),t=Object.keys(e).sort();return n.length===t.length&&n.every((o,i)=>o===t[i]&&r[o]===e[o])},Ma=class{constructor(e){this.tensorManager=$_(this);this.mlContextBySessionId=new Map;this.sessionIdsByMLContext=new Map;this.mlContextCache=[];this.sessionGraphInputs=new Map;this.sessionGraphOutputs=new Map;this.temporaryGraphInputs=[];this.temporaryGraphOutputs=[];this.temporarySessionTensorIds=new Map;this.mlOpSupportLimitsBySessionId=new Map;Da(e.logLevel,!!e.debug)}get currentSessionId(){if(this.activeSessionId===void 0)throw new Error("No active session");return this.activeSessionId}onRunStart(e){_e("verbose",()=>`[WebNN] onRunStart {sessionId: ${e}}`),this.activeSessionId=e}onRunEnd(e){_e("verbose",()=>`[WebNN] onRunEnd {sessionId: ${e}}`);let n=this.temporarySessionTensorIds.get(e);if(n){for(let t of n)_e("verbose",()=>`[WebNN] releasing temporary tensor {tensorId: ${t}}`),this.tensorManager.releaseTensorId(t);this.temporarySessionTensorIds.delete(e),this.activeSessionId=void 0}}async createMLContext(e){if(e instanceof GPUDevice){let t=this.mlContextCache.findIndex(o=>o.gpuDevice===e);if(t!==-1)return this.mlContextCache[t].mlContext;{let o=await navigator.ml.createContext(e);return this.mlContextCache.push({gpuDevice:e,mlContext:o}),o}}else if(e===void 0){let t=this.mlContextCache.findIndex(o=>o.options===void 0&&o.gpuDevice===void 0);if(t!==-1)return this.mlContextCache[t].mlContext;{let o=await navigator.ml.createContext();return this.mlContextCache.push({mlContext:o}),o}}let n=this.mlContextCache.findIndex(t=>v3(t.options,e));if(n!==-1)return this.mlContextCache[n].mlContext;{let t=await navigator.ml.createContext(e);return this.mlContextCache.push({options:e,mlContext:t}),t}}registerMLContext(e,n){this.mlContextBySessionId.set(e,n);let t=this.sessionIdsByMLContext.get(n);t||(t=new Set,this.sessionIdsByMLContext.set(n,t)),t.add(e),this.mlOpSupportLimitsBySessionId.has(e)||this.mlOpSupportLimitsBySessionId.set(e,n.opSupportLimits()),this.temporaryGraphInputs.length>0&&(this.sessionGraphInputs.set(e,this.temporaryGraphInputs),this.temporaryGraphInputs=[]),this.temporaryGraphOutputs.length>0&&(this.sessionGraphOutputs.set(e,this.temporaryGraphOutputs),this.temporaryGraphOutputs=[])}onReleaseSession(e){this.sessionGraphInputs.delete(e),this.sessionGraphOutputs.delete(e);let n=this.mlContextBySessionId.get(e);if(!n)return;this.tensorManager.releaseTensorsForSession(e),this.mlContextBySessionId.delete(e),this.mlOpSupportLimitsBySessionId.delete(e);let t=this.sessionIdsByMLContext.get(n);if(t.delete(e),t.size===0){this.sessionIdsByMLContext.delete(n);let o=this.mlContextCache.findIndex(i=>i.mlContext===n);o!==-1&&this.mlContextCache.splice(o,1)}}getMLContext(e){return this.mlContextBySessionId.get(e)}getMLOpSupportLimits(e){return this.mlOpSupportLimitsBySessionId.get(e)}reserveTensorId(){return this.tensorManager.reserveTensorId()}releaseTensorId(e){_e("verbose",()=>`[WebNN] releaseTensorId {tensorId: ${e}}`),this.tensorManager.releaseTensorId(e)}async ensureTensor(e,n,t,o,i){let a=za.get(t);if(!a)throw new Error(`Unsupported ONNX data type: ${t}`);return this.tensorManager.ensureTensor(e??this.currentSessionId,n,a,o,i)}async createTemporaryTensor(e,n,t){_e("verbose",()=>`[WebNN] createTemporaryTensor {onnxDataType: ${n}, shape: ${t}}`);let o=za.get(n);if(!o)throw new Error(`Unsupported ONNX data type: ${n}`);let i=this.tensorManager.reserveTensorId();await this.tensorManager.ensureTensor(e,i,o,t,!1);let a=this.temporarySessionTensorIds.get(e);return a?a.push(i):this.temporarySessionTensorIds.set(e,[i]),i}uploadTensor(e,n){if(!Ve().shouldTransferToMLTensor)throw new Error("Trying to upload to a MLTensor while shouldTransferToMLTensor is false");_e("verbose",()=>`[WebNN] uploadTensor {tensorId: ${e}, data: ${n.byteLength}}`),this.tensorManager.upload(e,n)}async downloadTensor(e,n){return this.tensorManager.download(e,n)}createMLTensorDownloader(e,n){return async()=>{let t=await this.tensorManager.download(e);return Na(t,n)}}registerMLTensor(e,n,t,o){let i=za.get(t);if(!i)throw new Error(`Unsupported ONNX data type: ${t}`);let a=this.tensorManager.registerTensor(e,n,i,o);return _e("verbose",()=>`[WebNN] registerMLTensor {tensor: ${n}, dataType: ${i}, dimensions: ${o}} -> {tensorId: ${a}}`),a}registerMLConstant(e,n,t,o,i,a,s=!1){if(!a)throw new Error("External mounted files are not available.");let u=e;e.startsWith("./")&&(u=e.substring(2));let l=a.get(u);if(!l)throw new Error(`File with name ${u} not found in preloaded files.`);if(n+t>l.byteLength)throw new Error("Out of bounds: data offset and length exceed the external file data size.");let d=l.slice(n,n+t).buffer,p;switch(i.dataType){case"float32":p=new Float32Array(d);break;case"float16":p=typeof Float16Array<"u"?new Float16Array(d):new Uint16Array(d);break;case"int32":p=new Int32Array(d);break;case"uint32":p=new Uint32Array(d);break;case"int64":if(s){let h=yc(new Uint8Array(d),"int64");p=new Int32Array(h.buffer),i.dataType="int32"}else p=new BigInt64Array(d);break;case"uint64":p=new BigUint64Array(d);break;case"int8":p=new Int8Array(d);break;case"int4":case"uint4":case"uint8":p=new Uint8Array(d);break;default:throw new Error(`Unsupported data type: ${i.dataType} in creating WebNN Constant from external data.`)}return _e("verbose",()=>`[WebNN] registerMLConstant {dataType: ${i.dataType}, shape: ${i.shape}}} ${s?"(Note: it was int64 data type and registered to int32 as workaround)":""}`),o.constant(i,p)}registerGraphInput(e){this.temporaryGraphInputs.push(e)}registerGraphOutput(e){this.temporaryGraphOutputs.push(e)}isGraphInput(e,n){let t=this.sessionGraphInputs.get(e);return t?t.includes(n):!1}isGraphOutput(e,n){let t=this.sessionGraphOutputs.get(e);return t?t.includes(n):!1}isGraphInputOutputTypeSupported(e,n,t=!0){let o=za.get(br(n)),i=this.mlOpSupportLimitsBySessionId.get(e);return typeof o>"u"?!1:t?!!i?.input.dataTypes.includes(o):!!i?.output.dataTypes.includes(o)}flush(){}}});var Ba=L(()=>{"use strict"});var P_,_c,wc,x3,T3,E_,xc,vc,D_,k_=L(()=>{"use strict";Un();Ba();P_=new Map([[64,250],[128,200],[256,200],[512,200],[2048,230],[4096,200],[8192,50],[16384,50],[32768,50],[65536,50],[131072,50],[262144,50],[524288,50],[1048576,50],[2097152,30],[4194304,20],[8388608,10],[12582912,10],[16777216,10],[26214400,15],[33554432,22],[44236800,2],[58982400,6],[67108864,6],[134217728,6],[167772160,6]]),_c=[],wc=r=>Math.ceil(Number(r)/16)*16,x3=r=>{for(let e=0;e<_c.length;e++){let n=_c[e];if(r<=n)return n}return Math.ceil(r/16)*16},T3=1,E_=()=>T3++,xc=async(r,e,n,t)=>{let o=wc(n),i=r.device.createBuffer({size:o,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});try{let a=r.getCommandEncoder();r.endComputePass(),a.copyBufferToBuffer(e,0,i,0,o),r.flush(),await i.mapAsync(GPUMapMode.READ);let s=i.getMappedRange();if(t){let u=t();return u.set(new Uint8Array(s,0,n)),u}else return new Uint8Array(s.slice(0,n))}finally{i.destroy()}},vc=class{constructor(e){this.backend=e;this.storageCache=new Map,this.freeBuffers=new Map,this.freeUniformBuffers=new Map,this.buffersPending=[],this.capturedPendingBuffers=new Map;for(let[n]of P_)_c.push(n),this.freeBuffers.set(n,[]),this.freeUniformBuffers.set(n,[]);this.sessionCount=0}upload(e,n){let t=n.buffer,o=n.byteOffset,i=n.byteLength,a=wc(i),s=this.storageCache.get(e);if(!s)throw new Error("gpu data for uploading does not exist");if(Number(s.originalSize)!==i)throw new Error(`inconsistent data size. gpu data size=${s.originalSize}, data size=${i}`);let u=this.backend.device.createBuffer({mappedAtCreation:!0,size:a,usage:GPUBufferUsage.MAP_WRITE|GPUBufferUsage.COPY_SRC}),l=u.getMappedRange();new Uint8Array(l).set(new Uint8Array(t,o,i)),u.unmap();let d=this.backend.device.createCommandEncoder();d.copyBufferToBuffer(u,0,s.gpuData.buffer,0,a),this.backend.device.queue.submit([d.finish()]),u.destroy(),_e("verbose",()=>`[WebGPU] GpuDataManager.upload(id=${e})`)}memcpy(e,n){let t=this.storageCache.get(e);if(!t)throw new Error("source gpu data for memcpy does not exist");let o=this.storageCache.get(n);if(!o)throw new Error("destination gpu data for memcpy does not exist");if(t.originalSize!==o.originalSize)throw new Error("inconsistent source and destination gpu data size");let i=wc(t.originalSize),a=this.backend.getCommandEncoder();this.backend.endComputePass(),a.copyBufferToBuffer(t.gpuData.buffer,0,o.gpuData.buffer,0,i)}registerExternalBuffer(e,n,t){let o;if(t){if(o=t[0],e===t[1])return _e("verbose",()=>`[WebGPU] GpuDataManager.registerExternalBuffer(size=${n}) => id=${o}, buffer is the same, skip.`),o;if(this.backend.capturedCommandList.has(this.backend.currentSessionId))throw new Error(`Registering a different external buffer under graph capture mode is not supported yet.
             Please use the previous external buffer!`)}else o=E_();return this.storageCache.set(o,{gpuData:{id:o,type:0,buffer:e},originalSize:n}),_e("verbose",()=>`[WebGPU] GpuDataManager.registerExternalBuffer(size=${n}) => id=${o}, registered.`),o}unregisterExternalBuffer(e){e!==void 0&&(this.storageCache.delete(e),_e("verbose",()=>`[WebGPU] GpuDataManager.unregisterExternalBuffer() => id=${e}`))}create(e,n=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST){let t=x3(e),o,i=(n&GPUBufferUsage.STORAGE)===GPUBufferUsage.STORAGE,a=(n&GPUBufferUsage.UNIFORM)===GPUBufferUsage.UNIFORM;if(i||a){let l=(i?this.freeBuffers:this.freeUniformBuffers).get(t);l?l.length>0?o=l.pop():o=this.backend.device.createBuffer({size:t,usage:n}):o=this.backend.device.createBuffer({size:t,usage:n})}else o=this.backend.device.createBuffer({size:t,usage:n});let s={id:E_(),type:0,buffer:o};return this.storageCache.set(s.id,{gpuData:s,originalSize:Number(e)}),_e("verbose",()=>`[WebGPU] GpuDataManager.create(size=${e}) => id=${s.id}`),s}get(e){return this.storageCache.get(e)?.gpuData}release(e){let n=typeof e=="bigint"?Number(e):e,t=this.storageCache.get(n);if(!t){if(this.storageCache.size===0)return 0;throw new Error("releasing data does not exist")}return _e("verbose",()=>`[WebGPU] GpuDataManager.release(id=${n}), gpuDataId=${t.gpuData.id}`),this.storageCache.delete(n),this.buffersPending.push(t.gpuData.buffer),t.originalSize}async download(e,n){let t=this.storageCache.get(Number(e));if(!t)throw new Error("data does not exist");await xc(this.backend,t.gpuData.buffer,t.originalSize,n)}refreshPendingBuffers(){if(this.buffersPending.length!==0)if(this.backend.sessionStatus==="default"){for(let e of this.buffersPending){let n=P_.get(e.size);if((e.usage&GPUBufferUsage.STORAGE)===GPUBufferUsage.STORAGE){let t=this.freeBuffers.get(e.size)||[];n===void 0||t.length>=n?e.destroy():t.push(e)}else if((e.usage&GPUBufferUsage.UNIFORM)===GPUBufferUsage.UNIFORM){let t=this.freeUniformBuffers.get(e.size)||[];n===void 0||t.length>=n?e.destroy():t.push(e)}else e.destroy()}this.buffersPending=[]}else{let e=this.capturedPendingBuffers.get(this.backend.currentSessionId);e||(e=[],this.capturedPendingBuffers.set(this.backend.currentSessionId,e));for(let n of this.buffersPending)e.push(n);this.buffersPending=[]}}dispose(){this.freeBuffers.forEach(e=>{e.forEach(n=>{n.destroy()})}),this.freeUniformBuffers.forEach(e=>{e.forEach(n=>{n.destroy()})}),this.storageCache.forEach(e=>{e.gpuData.buffer.destroy()}),this.capturedPendingBuffers.forEach(e=>{e.forEach(n=>{n.destroy()})}),this.storageCache=new Map,this.freeBuffers=new Map,this.freeUniformBuffers=new Map,this.capturedPendingBuffers=new Map}onCreateSession(){this.sessionCount+=1}onReleaseSession(e){let n=this.capturedPendingBuffers.get(e);n&&(n.forEach(t=>{t.destroy()}),this.capturedPendingBuffers.delete(e)),this.sessionCount-=1,this.sessionCount===0&&(_e("warning",()=>"[WebGPU] Clearing webgpu buffer cache"),this.storageCache.forEach(t=>{t.gpuData.buffer.destroy()}),this.storageCache=new Map)}},D_=(...r)=>new vc(...r)});var Tc,de,et=L(()=>{"use strict";Tc=class{constructor(e){Object.assign(this,e)}get cacheKey(){return this.key||(this.key=Object.getOwnPropertyNames(this).sort().map(e=>`${this[e]}`).join(";")),this.key}},de=r=>new Tc(r)});var Gr,Sc,Ue,lt,K,Ce,$c,Ur,Zt,re,Va,M,H,N_,Ga,Ic,L_,be=L(()=>{"use strict";ce();me();Gr=64,Sc=(r,e)=>{if(e===3)throw new Error("vec3 has same alignment as vec4, use vec4 instead");switch(Number(r)){case 10:return e>1?`vec${e}<f16>`:"f16";case 1:return e>1?`vec${e}<f32>`:"f32";case 6:return e>1?`vec${e}<i32>`:"i32";case 12:return e>1?`vec${e}<u32>`:"u32";case 7:if(e>1)throw new Error("currently not supported vecX of uint64 yet");return["vec2<u32>","i32"];case 13:if(e>1)throw new Error("currently not supported vecX of uint64 yet");return["vec2<u32>","u32"];case 9:if(e!==4)throw new Error("bool must be vec4");return["u32","vec4<bool>"];case 22:return"i32";case 21:return"u32";default:throw new Error(`Unknown data type: ${r}`)}},Ue=(r,e=1)=>{let n=Sc(r,e);return typeof n=="string"?n:n[0]},lt=(r,e=1)=>{let n=Sc(r,e);return typeof n=="string"?n:n[1]},K=(...r)=>{let e=[];return r.forEach(n=>{n.length!==0&&e.push({type:12,data:n},{type:12,data:k.computeStrides(n)})}),e},Ce=r=>r%4===0?4:r%2===0?2:1,$c=(r="f32",e,n="0")=>!e||e===1?`${r}(${n})`:`vec${e}<${r}>(${n})`,Ur=(r,e,n)=>r==="f32"?n:e===1?`f32(${n})`:`vec${e}<f32>(${n})`,Zt=(r,e)=>e===4?`(${r}.x + ${r}.y + ${r}.z + ${r}.w)`:e===2?`(${r}.x + ${r}.y)`:e===3?`(${r}.x + ${r}.y + ${r}.z)`:r,re=(r,e,n,t)=>r.startsWith("uniforms.")&&n>4?typeof e=="string"?t==="f16"?`${r}[(${e}) / 8][(${e}) % 8 / 4][(${e}) % 8 % 4]`:`${r}[(${e}) / 4][(${e}) % 4]`:t==="f16"?`${r}[${Math.floor(e/8)}][${Math.floor(e%8/4)}][${e%8%4}]`:`${r}[${Math.floor(e/4)}][${e%4}]`:n>1?`${r}[${e}]`:r,Va=(r,e,n,t,o)=>{let i=typeof n=="number",a=i?n:n.length,s=[...new Array(a).keys()],u=a<2?"u32":a<=4?`vec${a}<u32>`:`array<u32, ${a}>`,l=Sc(e,o),d=typeof l=="string"?l:l[1],p=typeof l=="string"?l:l[0],h={indices:u,value:d,storage:p,tensor:e},g=U=>typeof U=="string"?U:`${U}u`,b={offsetToIndices:!1,indicesToOffset:!1,broadcastedIndicesToOffset:!1,set:!1,setByIndices:!1,get:!1,getByIndices:!1},_=i?"uniforms.":"",S=`${_}${r}_shape`,v=`${_}${r}_strides`,x="";for(let U=0;U<a-1;U++)x+=`
    let dim${U} = current / ${re(v,U,a)};
    let rest${U} = current % ${re(v,U,a)};
    indices[${U}] = dim${U};
    current = rest${U};
    `;x+=`indices[${a-1}] = current;`;let $=a<2?"":`
  fn o2i_${r}(offset: u32) -> ${h.indices} {
    var indices: ${h.indices};
    var current = offset;
    ${x}
    return indices;
  }`,O=U=>(b.offsetToIndices=!0,a<2?U:`o2i_${r}(${U})`),E=[];if(a>=2)for(let U=a-1;U>=0;U--)E.push(`${re(v,U,a)} * (indices[${U}])`);let D=a<2?"":`
  fn i2o_${r}(indices: ${h.indices}) -> u32 {
    return ${E.join("+")};
  }`,B=U=>(b.indicesToOffset=!0,a<2?U:`i2o_${r}(${U})`),T=(...U)=>a===0?"0u":`${h.indices}(${U.map(g).join(",")})`,F=(U,q)=>a<2?`${U}`:`${re(U,q,a)}`,W=(U,q,ye)=>a<2?`${U}=${ye};`:`${re(U,q,a)}=${ye};`,z={},te=(U,q)=>{b.broadcastedIndicesToOffset=!0;let ye=`${q.name}broadcastedIndicesTo${r}Offset`;if(ye in z)return`${ye}(${U})`;let Je=[];for(let Fe=a-1;Fe>=0;Fe--){let st=q.indicesGet("outputIndices",Fe+q.rank-a);Je.push(`${F(v,Fe)} * (${st} % ${F(S,Fe)})`)}return z[ye]=`fn ${ye}(outputIndices: ${q.type.indices}) -> u32 {
             return ${Je.length>0?Je.join("+"):"0u"};
           }`,`${ye}(${U})`},V=(U,q)=>(()=>{if(h.storage===h.value)return`${r}[${U}]=${q};`;if(h.storage==="vec2<u32>"&&h.value==="i32")return`${r}[${U}]=vec2<u32>(u32(${q}), select(0u, 0xFFFFFFFFu, ${q} < 0));`;if(h.storage==="vec2<u32>"&&h.value==="u32")return`${r}[${U}]=vec2<u32>(u32(${q}), 0u);`;if(h.storage==="u32"&&h.value==="vec4<bool>")return`${r}[${U}]=dot(vec4<u32>(0x1, 0x100, 0x10000, 0x1000000), vec4<u32>(${q}));`;throw new Error(`not supported combination of storage type ${h.storage} and value type ${h.value} yet`)})(),w=U=>(()=>{if(h.storage===h.value)return`${r}[${U}]`;if(h.storage==="vec2<u32>"&&h.value==="i32")return`i32(${r}[${U}].x)`;if(h.storage==="vec2<u32>"&&h.value==="u32")return`u32(${r}[${U}].x)`;if(h.storage==="u32"&&h.value==="vec4<bool>")return`vec4<bool>(bool(${r}[${U}] & 0xFFu), bool(${r}[${U}] & 0xFF00u), bool(${r}[${U}] & 0xFF0000u), bool(${r}[${U}] & 0xFF000000u))`;throw new Error(`not supported combination of storage type ${h.storage} and value type ${h.value} yet`)})(),R=a<2?"":`
  fn get_${r}ByIndices(indices: ${h.indices}) -> ${d} {
    return ${w(`i2o_${r}(indices)`)};
  }`,j=a<2?"":(()=>{let U=s.map(ye=>`d${ye}: u32`).join(", "),q=s.map(ye=>`d${ye}`).join(", ");return`
  fn get_${r}(${U}) -> ${d} {
    return get_${r}ByIndices(${T(q)});
  }`})(),J=(...U)=>{if(U.length!==a)throw new Error(`indices length must be ${a}`);let q=U.map(g).join(",");return a===0?w("0u"):a===1?w(q[0]):(b.get=!0,b.getByIndices=!0,b.indicesToOffset=!0,`get_${r}(${q})`)},Z=U=>a<2?w(U):(b.getByIndices=!0,b.indicesToOffset=!0,`get_${r}ByIndices(${U})`),oe=a<2?"":`
  fn set_${r}ByIndices(indices: ${h.indices}, value: ${d}) {
    ${V(`i2o_${r}(indices)`,"value")}
  }`,se=a<2?"":(()=>{let U=s.map(ye=>`d${ye}: u32`).join(", "),q=s.map(ye=>`d${ye}`).join(", ");return`
  fn set_${r}(${U}, value: ${d}) {
    set_${r}ByIndices(${T(q)}, value);
  }`})();return{impl:()=>{let U=[],q=!1;return b.offsetToIndices&&(U.push($),q=!0),b.indicesToOffset&&(U.push(D),q=!0),b.broadcastedIndicesToOffset&&(Object.values(z).forEach(ye=>U.push(ye)),q=!0),b.set&&(U.push(se),q=!0),b.setByIndices&&(U.push(oe),q=!0),b.get&&(U.push(j),q=!0),b.getByIndices&&(U.push(R),q=!0),!i&&q&&U.unshift(`const ${S} = ${h.indices}(${n.join(",")});`,`const ${v} = ${h.indices}(${k.computeStrides(n).join(",")});`),U.join(`
`)},type:h,offsetToIndices:O,indicesToOffset:B,broadcastedIndicesToOffset:te,indices:T,indicesGet:F,indicesSet:W,set:(...U)=>{if(U.length!==a+1)throw new Error(`indices length must be ${a}`);let q=U[a];if(typeof q!="string")throw new Error("value must be string");let ye=U.slice(0,a).map(g).join(",");return a===0?V("0u",q):a===1?V(ye[0],q):(b.set=!0,b.setByIndices=!0,b.indicesToOffset=!0,`set_${r}(${ye}, ${q})`)},setByOffset:V,setByIndices:(U,q)=>a<2?V(U,q):(b.setByIndices=!0,b.indicesToOffset=!0,`set_${r}ByIndices(${U}, ${q});`),get:J,getByOffset:w,getByIndices:Z,usage:t,name:r,strides:v,shape:S,rank:a}},M=(r,e,n,t=1)=>Va(r,e,n,"input",t),H=(r,e,n,t=1)=>Va(r,e,n,"output",t),N_=(r,e,n)=>Va(r,e,n,"atomicOutput",1),Ga=(r,e,n,t=1)=>Va(r,e,n,"internal",t),Ic=class{constructor(e,n){this.normalizedDispatchGroup=e;this.limits=n;this.internalVariables=[];this.variables=[];this.uniforms=[];this.variableIndex=0}guardAgainstOutOfBoundsWorkgroupSizes(e){return`if (global_idx >= ${typeof e=="number"?`${e}u`:e}) { return; }`}mainStart(e=Gr){let n=typeof e=="number"?e:e[0],t=typeof e=="number"?1:e[1],o=typeof e=="number"?1:e[2];if(n>this.limits.maxComputeWorkgroupSizeX||t>this.limits.maxComputeWorkgroupSizeY||o>this.limits.maxComputeWorkgroupSizeZ)throw new Error(`workgroup size [${n}, ${t}, ${o}] exceeds the maximum workgroup size [${this.limits.maxComputeWorkgroupSizeX}, ${this.limits.maxComputeWorkgroupSizeY}, ${this.limits.maxComputeWorkgroupSizeZ}].`);if(n*t*o>this.limits.maxComputeInvocationsPerWorkgroup)throw new Error(`workgroup size [${n}, ${t}, ${o}] exceeds the maximum workgroup invocations ${this.limits.maxComputeInvocationsPerWorkgroup}.`);let i=this.normalizedDispatchGroup[1]===1&&this.normalizedDispatchGroup[2]===1,a=i?`@builtin(global_invocation_id) global_id : vec3<u32>,
    @builtin(workgroup_id) workgroup_id : vec3<u32>,
    @builtin(local_invocation_index) local_idx : u32,
    @builtin(local_invocation_id) local_id : vec3<u32>`:`@builtin(global_invocation_id) global_id : vec3<u32>,
                                             @builtin(local_invocation_id) local_id : vec3<u32>,
    @builtin(local_invocation_index) local_idx : u32,
    @builtin(workgroup_id) workgroup_id : vec3<u32>,
    @builtin(num_workgroups) num_workgroups : vec3<u32>`,s=i?`let global_idx = global_id.x;
         let workgroup_index = workgroup_id.x;`:`let workgroup_index = workgroup_id.z * num_workgroups[0] * num_workgroups[1] +
             workgroup_id.y * num_workgroups[0] + workgroup_id.x;
         let global_idx = workgroup_index * ${n*t*o}u + local_idx;`;return`@compute @workgroup_size(${n}, ${t}, ${o})
  fn main(${a}) {
    ${s}
  `}appendVariableUniforms(e){e.rank!==0&&(e.shape.startsWith("uniforms.")&&this.uniforms.push({name:e.shape.replace("uniforms.",""),type:"u32",length:e.rank}),e.strides.startsWith("uniforms.")&&this.uniforms.push({name:e.strides.replace("uniforms.",""),type:"u32",length:e.rank}))}declareVariable(e,n){if(e.usage==="internal")throw new Error("cannot use internal variable with declareVariable(). use registerInternalVariables() instead.");this.variables.push(e),this.appendVariableUniforms(e);let t=e.usage==="input"?"read":"read_write",o=e.usage==="atomicOutput"?"atomic<i32>":e.type.storage;return`@group(0) @binding(${n}) var<storage, ${t}> ${e.name}: array<${o}>;`}declareVariables(...e){return e.map(n=>this.declareVariable(n,this.variableIndex++)).join(`
`)}registerInternalVariable(e){if(e.usage!=="internal")throw new Error("cannot use input or output variable with registerInternalVariable(). use declareVariables() instead.");this.internalVariables.push(e),this.appendVariableUniforms(e)}registerInternalVariables(...e){return e.forEach(n=>this.registerInternalVariable(n)),this}registerUniform(e,n,t=1){return this.uniforms.push({name:e,type:n,length:t}),this}registerUniforms(e){return this.uniforms=this.uniforms.concat(e),this}uniformDeclaration(){if(this.uniforms.length===0)return"";let e=[];for(let{name:n,type:t,length:o}of this.uniforms)if(o&&o>4)t==="f16"?e.push(`@align(16) ${n}:array<mat2x4<${t}>, ${Math.ceil(o/8)}>`):e.push(`${n}:array<vec4<${t}>, ${Math.ceil(o/4)}>`);else{let i=o==null||o===1?t:`vec${o}<${t}>`;e.push(`${n}:${i}`)}return`
      struct Uniforms { ${e.join(", ")} };
      @group(0) @binding(${this.variableIndex}) var<uniform> uniforms: Uniforms;`}get additionalImplementations(){return this.uniformDeclaration()+this.variables.map(e=>e.impl()).join(`
`)+this.internalVariables.map(e=>e.impl()).join(`
`)}get variablesInfo(){if(this.uniforms.length===0)return;let e=n=>[12,10,1,6][["u32","f16","f32","i32"].indexOf(n)];return this.uniforms.map(n=>[e(n.type),n.length??1])}},L_=(r,e)=>new Ic(r,e)});var I3,R_,S3,$3,A3,O3,ct,z_,M_,Qn=L(()=>{"use strict";ce();me();et();be();I3=(r,e)=>{if(!r||r.length!==1)throw new Error("Transpose requires 1 input.");if(e.length!==0&&e.length!==r[0].dims.length)throw new Error(`perm size ${e.length} does not match input rank ${r[0].dims.length}`)},R_=(r,e)=>e.length!==0?e:[...new Array(r).keys()].reverse(),S3=(r,e)=>k.sortBasedOnPerm(r,R_(r.length,e)),$3=(r,e,n,t)=>{let o=`fn perm(i: ${t.type.indices}) -> ${n.type.indices} {
    var a: ${n.type.indices};`;for(let i=0;i<e;++i)o+=`a[${r[i]}]=i[${i}];`;return o+="return a;}"},A3=(r,e)=>{let n=[],t=[];for(let o=0;o<r.length;++o)r[o]!==1&&n.push(r[o]),r[e[o]]!==1&&t.push(e[o]);return{newShape:n,newPerm:t}},O3=(r,e)=>{let n=0;for(let t=0;t<r.length;++t)if(e[r[t]]!==1){if(r[t]<n)return!1;n=r[t]}return!0},ct=(r,e)=>{let n=r.dataType,t=r.dims.length,o=R_(t,e),i=S3(r.dims,o),a=r.dims,s=i,u=t<2||O3(o,r.dims),l;if(u)return l=_=>{let S=M("input",n,a,4),v=H("output",n,s,4);return`
  ${_.registerUniform("output_size","u32").declareVariables(S,v)}
  ${_.mainStart()}
    ${_.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    output[global_idx] = input[global_idx];
  }`},{name:"TransposeCopy",shaderCache:{inputDependencies:["type"]},getRunData:()=>{let _=k.size(i);return{outputs:[{dims:i,dataType:r.dataType}],dispatchGroup:{x:Math.ceil(_/64/4)},programUniforms:[{type:12,data:Math.ceil(_/4)}]}},getShaderSource:l};let{newShape:d,newPerm:p}=A3(r.dims,o),h=k.areEqual(p,[2,3,1]),g=k.areEqual(p,[3,1,2]);if(d.length===2||h||g){a=h?[d[0],d[1]*d[2]]:g?[d[0]*d[1],d[2]]:d,s=[a[1],a[0]];let _=16;return l=S=>{let v=M("a",n,a.length),x=H("output",n,s.length);return`
  ${S.registerUniform("output_size","u32").declareVariables(v,x)}
  var<workgroup> tile : array<array<${x.type.value}, ${_+1}>, ${_}>;
  ${S.mainStart([_,_,1])}
    let stride = (uniforms.output_shape[1] - 1) / ${_} + 1;
    let workgroup_id_x = workgroup_index % stride;
    let workgroup_id_y = workgroup_index / stride;
    let input_col = workgroup_id_y * ${_}u + local_id.x;
    let input_row = workgroup_id_x * ${_}u + local_id.y;
    if (input_row < uniforms.a_shape[0] && input_col < uniforms.a_shape[1]) {
      tile[local_id.y][local_id.x] = ${v.getByIndices(`${v.type.indices}(input_row, input_col)`)};
    }
    workgroupBarrier();

    let output_col = workgroup_id_x * ${_}u + local_id.x;
    let output_row = workgroup_id_y * ${_}u + local_id.y;
    if (output_row < uniforms.output_shape[0] && output_col < uniforms.output_shape[1]) {
      ${x.setByIndices(`${x.type.indices}(output_row, output_col)`,"tile[local_id.x][local_id.y]")}
    }
  }`},{name:"TransposeShared",shaderCache:{inputDependencies:["type"]},getRunData:()=>{let S=k.size(i);return{outputs:[{dims:i,dataType:r.dataType}],dispatchGroup:{x:Math.ceil(s[1]/_),y:Math.ceil(s[0]/_)},programUniforms:[{type:12,data:S},...K(a,s)]}},getShaderSource:l}}return l=_=>{let S=M("a",n,a.length),v=H("output",n,s.length);return`
  ${_.registerUniform("output_size","u32").declareVariables(S,v)}

  ${$3(o,t,S,v)}

  ${_.mainStart()}
    ${_.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let indices = ${v.offsetToIndices("global_idx")};
    let aIndices = perm(indices);

    ${v.setByOffset("global_idx",S.getByIndices("aIndices"))}
  }`},{name:"Transpose",shaderCache:{hint:`${e}`,inputDependencies:["rank"]},getRunData:()=>{let _=k.size(i);return{outputs:[{dims:i,dataType:r.dataType}],dispatchGroup:{x:Math.ceil(_/64)},programUniforms:[{type:12,data:_},...K(a,s)]}},getShaderSource:l}},z_=(r,e)=>{I3(r.inputs,e.perm),r.compute(ct(r.inputs[0],e.perm))},M_=r=>de({perm:r.perm})});var P3,E3,C3,D3,k3,N3,L3,R3,z3,M3,Wn,B_,V_,G_,U_,F_,W_,H_,q_,j_,K_,X_=L(()=>{"use strict";ce();me();be();Ua();Qn();P3={max:"select(bestValue, candidate, candidate > bestValue)",min:"select(bestValue, candidate, candidate < bestValue)",mean:"bestValue + candidate",sum:"bestValue + candidate",prod:"bestValue * candidate",sumSquare:"bestValue + candidate * candidate",logSumExp:"bestValue + exp(candidate)",l1:"bestValue + abs(candidate)",l2:"bestValue + candidate * candidate",logSum:"bestValue + candidate"},E3={max:"select(bestValue, candidate, candidate > bestValue)",min:"select(bestValue, candidate, candidate < bestValue)",mean:"bestValue + candidate",sum:"bestValue + candidate",prod:"bestValue * candidate",sumSquare:"bestValue + candidate",logSumExp:"bestValue + candidate",l1:"bestValue + candidate",l2:"bestValue + candidate",logSum:"bestValue + candidate"},C3={max:"_A[offset]",min:"_A[offset]",mean:"0",sum:"0",prod:"1",sumSquare:"0",logSumExp:"0",l1:"0",l2:"0",logSum:"0"},D3={max:"bestValue",min:"bestValue",sum:"bestValue",prod:"bestValue",sumSquare:"bestValue",logSumExp:"log(bestValue)",l1:"bestValue",l2:"sqrt(bestValue)",logSum:"log(bestValue)"},k3=(r,e)=>{let n=[];for(let t=e-r;t<e;++t)n.push(t);return n},N3=(r,e)=>{let n=[],t=r.length;for(let i=0;i<t;i++)e.indexOf(i)===-1&&n.push(r[i]);let o=e.map(i=>r[i]);return[n,o]},L3=(r,e)=>{let n=r.length+e.length,t=[],o=0;for(let i=0;i<n;i++)e.indexOf(i)===-1?t.push(r[o++]):t.push(1);return t},R3=(r,e)=>{for(let n=0;n<r.length;++n)if(r[r.length-n-1]!==e-1-n)return!1;return!0},z3=(r,e)=>{let n=[];if(!R3(r,e)){for(let t=0;t<e;++t)r.indexOf(t)===-1&&n.push(t);r.forEach(t=>n.push(t))}return n},M3=(r,e,n,t,o,i,a)=>{let s=n[0].dims,u=k.size(i),l=k.size(a),d=M("_A",n[0].dataType,s),p=H("output",o,i),h=64;u===1&&(h=256);let g=`
          var<workgroup> aBestValues : array<f32, ${h}>;
       `,b=_=>`
        ${_.registerUniform("reduceSize","u32").declareVariables(d,p)}
        ${g}
        fn DIV_CEIL(a : u32, b : u32) -> u32 {
          return ((a - 1u) / b + 1u);
         }
         ${_.mainStart(h)}

          let outputIndex = global_idx / ${h};
          let offset = outputIndex * uniforms.reduceSize;

          var bestValue = f32(${C3[t]});
          let Length = uniforms.reduceSize;
          for (var k = local_idx; k < Length; k = k + ${h}) {
           let candidate = f32(${d.getByOffset("offset + k")});
           bestValue = ${P3[t]};
          }
          aBestValues[local_idx] = bestValue;
          workgroupBarrier();

         var reduceSize = min(Length, ${h}u);
         for (var currentSize = reduceSize / 2u; reduceSize > 1u;
             currentSize = reduceSize / 2u) {
           let interval = DIV_CEIL(reduceSize, 2u);
           if (local_idx < currentSize) {
            let candidate = aBestValues[local_idx + interval];
            bestValue = ${E3[t]};
            aBestValues[local_idx] = bestValue;
           }
           reduceSize = interval;
           workgroupBarrier();
         }

         if (local_idx == 0u) {
          ${p.setByOffset("outputIndex",`${t==="mean"?`${p.type.storage}(bestValue / f32(uniforms.reduceSize))`:`${p.type.storage}(${D3[t]})`}`)};
         }
        }`;return{name:r,shaderCache:{hint:`${e};${h}`,inputDependencies:["type"]},getShaderSource:b,getRunData:()=>({outputs:[{dims:i,dataType:o}],dispatchGroup:{x:u},programUniforms:[{type:12,data:l}]})}},Wn=(r,e,n,t)=>{let o=r.inputs.length===1?n:Ac(r.inputs,n),i=o.axes;i.length===0&&!o.noopWithEmptyAxes&&(i=r.inputs[0].dims.map((g,b)=>b));let a=k.normalizeAxes(i,r.inputs[0].dims.length),s=a,u=r.inputs[0],l=z3(s,r.inputs[0].dims.length);l.length>0&&(u=r.compute(ct(r.inputs[0],l),{inputs:[0],outputs:[-1]})[0],s=k3(s.length,u.dims.length));let[d,p]=N3(u.dims,s),h=d;o.keepDims&&(h=L3(d,a)),r.compute(M3(e,o.cacheKey,[u],t,r.inputs[0].dataType,h,p),{inputs:[u]})},B_=(r,e)=>{Wn(r,"ReduceMeanShared",e,"mean")},V_=(r,e)=>{Wn(r,"ReduceL1Shared",e,"l1")},G_=(r,e)=>{Wn(r,"ReduceL2Shared",e,"l2")},U_=(r,e)=>{Wn(r,"ReduceLogSumExpShared",e,"logSumExp")},F_=(r,e)=>{Wn(r,"ReduceMaxShared",e,"max")},W_=(r,e)=>{Wn(r,"ReduceMinShared",e,"min")},H_=(r,e)=>{Wn(r,"ReduceProdShared",e,"prod")},q_=(r,e)=>{Wn(r,"ReduceSumShared",e,"sum")},j_=(r,e)=>{Wn(r,"ReduceSumSquareShared",e,"sumSquare")},K_=(r,e)=>{Wn(r,"ReduceLogSumShared",e,"logSum")}});var Hn,B3,Fa,Ac,qn,V3,G3,U3,F3,W3,H3,q3,j3,K3,X3,jn,Z_,J_,Y_,Q_,e0,t0,n0,r0,o0,i0,Ua=L(()=>{"use strict";ce();me();et();be();X_();Hn=r=>{if(!r||r.length===0||r.length>2)throw new Error("Reduce op requires 1 or 2 inputs.");if(r.length===2&&r[1].dims.length!==1)throw new Error("Invalid axes input dims.")},B3=r=>["","",`var value = ${r.getByIndices("input_indices")};`,""],Fa=(r,e,n,t,o,i,a=!1,s=!1)=>{let u=[],l=n[0].dims,d=l.length,p=k.normalizeAxes(o,d),h=!s&&p.length===0;l.forEach((S,v)=>{h||p.indexOf(v)>=0?a&&u.push(1):u.push(S)});let g=u.length,b=k.size(u);return{name:r,shaderCache:e,getShaderSource:S=>{let v=[],x=M("_A",n[0].dataType,d),$=H("output",i,g),O=t(x,$,p),E=O[2];for(let D=0,B=0;D<d;D++)h||p.indexOf(D)>=0?(a&&B++,E=`for(var j${D}: u32 = 0; j${D} < ${l[D]}; j${D}++) {
                  ${O[2].includes("last_index")?`let last_index = j${D};`:""}
                  ${x.indicesSet("input_indices",D,`j${D}`)}
                  ${E}
                }`):(v.push(`${x.indicesSet("input_indices",D,$.indicesGet("output_indices",B))};`),B++);return`

        ${S.registerUniform("output_size","u32").declareVariables(x,$)}

        ${S.mainStart()}
          ${S.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
          var input_indices: ${x.type.indices};
          let output_indices = ${$.offsetToIndices("global_idx")};

          ${v.join(`
`)}
          ${O[0]}       // init ops for reduce max/min
          ${O[1]}
          ${E}
          ${O[3]}
          ${O.length===4?$.setByOffset("global_idx","value"):O.slice(4).join(`
`)}
        }`},getRunData:()=>({outputs:[{dims:u,dataType:i}],dispatchGroup:{x:Math.ceil(b/64)},programUniforms:[{type:12,data:b},...K(l,u)]})}},Ac=(r,e)=>{let n=[];return r[1].dims[0]>0&&r[1].getBigInt64Array().forEach(t=>n.push(Number(t))),de({axes:n,keepDims:e.keepDims,noopWithEmptyAxes:e.noopWithEmptyAxes})},qn=(r,e,n,t)=>{let o=r.inputs,i=o.length===1?n:Ac(o,n);r.compute(Fa(e,{hint:i.cacheKey,inputDependencies:["rank"]},[o[0]],i.noopWithEmptyAxes&&i.axes.length===0?B3:t,i.axes,o[0].dataType,i.keepDims,i.noopWithEmptyAxes),{inputs:[0]})},V3=(r,e)=>{Hn(r.inputs),qn(r,"ReduceLogSum",e,(t,o)=>[`var value = ${o.type.storage}(0);`,"",`value += ${t.getByIndices("input_indices")};`,"value = log(value);"])},G3=(r,e)=>{Hn(r.inputs),qn(r,"ReduceL1",e,(t,o)=>[`var value = ${o.type.storage}(0);`,"",`value += abs(${t.getByIndices("input_indices")});`,""])},U3=(r,e)=>{Hn(r.inputs),qn(r,"ReduceL2",e,(t,o)=>[`var t = ${o.type.value}(0); var value = ${o.type.value}(0);`,"",`t = ${t.getByIndices("input_indices")}; value += (t * t);`,"value = sqrt(value);"])},F3=(r,e)=>{Hn(r.inputs),qn(r,"ReduceLogSumExp",e,(t,o)=>[`var value = ${o.type.storage}(0);`,"",`value += exp(${t.getByIndices("input_indices")});`,"value = log(value);"])},W3=(r,e)=>{Hn(r.inputs),qn(r,"ReduceMax",e,(t,o,i)=>{let a=[];for(let s=0;s<t.rank;s++)(i.indexOf(s)>=0||i.length===0)&&a.push(t.indicesSet("input_indices",s,0));return[`${a.join(`
`)}`,`var value = ${t.getByIndices("input_indices")};`,`value = max(value, ${t.getByIndices("input_indices")});`,""]})},H3=(r,e)=>{Hn(r.inputs),qn(r,"ReduceMean",e,(t,o,i)=>{let a=1;for(let s=0;s<t.rank;s++)(i.indexOf(s)>=0||i.length===0)&&(a*=r.inputs[0].dims[s]);return["var sum = f32(0);","",`sum += f32(${t.getByIndices("input_indices")});`,`let value = ${o.type.value}(sum / ${a});`]})},q3=(r,e)=>{Hn(r.inputs),qn(r,"ReduceMin",e,(t,o,i)=>{let a=[];for(let s=0;s<t.rank;s++)(i.indexOf(s)>=0||i.length===0)&&a.push(`input_indices[${s}] = 0;`);return[`${a.join(`
`)}`,`var value = ${t.getByIndices("input_indices")};`,`value = min(value, ${t.getByIndices("input_indices")});`,""]})},j3=(r,e)=>{Hn(r.inputs),qn(r,"ReduceProd",e,(t,o)=>[`var value = ${o.type.storage}(1);`,"",`value *= ${t.getByIndices("input_indices")};`,""])},K3=(r,e)=>{Hn(r.inputs),qn(r,"ReduceSum",e,(t,o)=>[`var value = ${o.type.storage}(0);`,"",`value += ${t.getByIndices("input_indices")};`,""])},X3=(r,e)=>{Hn(r.inputs),qn(r,"ReduceSumSquare",e,(t,o)=>[`var t = ${o.type.value}(0); var value = ${o.type.value}(0);`,"",`t = ${t.getByIndices("input_indices")}; value += t * t;`,""])},jn=(r,e,n)=>{if(e.length===0)return n;let t=1,o=1;for(let i=0;i<e.length;i++)e.indexOf(i)===-1?t*=r[i]:o*=r[i];return o<32&&t>1024},Z_=(r,e)=>{jn(r.inputs[0].dims,e.axes,e.noopWithEmptyAxes)?H3(r,e):B_(r,e)},J_=(r,e)=>{jn(r.inputs[0].dims,e.axes,e.noopWithEmptyAxes)?G3(r,e):V_(r,e)},Y_=(r,e)=>{jn(r.inputs[0].dims,e.axes,e.noopWithEmptyAxes)?U3(r,e):G_(r,e)},Q_=(r,e)=>{jn(r.inputs[0].dims,e.axes,e.noopWithEmptyAxes)?F3(r,e):U_(r,e)},e0=(r,e)=>{jn(r.inputs[0].dims,e.axes,e.noopWithEmptyAxes)?W3(r,e):F_(r,e)},t0=(r,e)=>{jn(r.inputs[0].dims,e.axes,e.noopWithEmptyAxes)?q3(r,e):W_(r,e)},n0=(r,e)=>{jn(r.inputs[0].dims,e.axes,e.noopWithEmptyAxes)?j3(r,e):H_(r,e)},r0=(r,e)=>{jn(r.inputs[0].dims,e.axes,e.noopWithEmptyAxes)?K3(r,e):q_(r,e)},o0=(r,e)=>{jn(r.inputs[0].dims,e.axes,e.noopWithEmptyAxes)?X3(r,e):j_(r,e)},i0=(r,e)=>{jn(r.inputs[0].dims,e.axes,e.noopWithEmptyAxes)?V3(r,e):K_(r,e)}});var a0,s0,u0,Oc,l0=L(()=>{"use strict";ce();et();Ua();a0=r=>{if(!r||r.length===0||r.length>2)throw new Error("ArgMinMaxOp op requires 1 or 2 inputs.");if(r[0].dataType!==1)throw new Error("Invalid input type.")},s0=(r,e)=>{a0(r.inputs);let n=(t,o,i)=>{let a=[];for(let s=0;s<t.rank;s++)(i.indexOf(s)>=0||i.length===0)&&a.push(`input_indices[${s}] = 0;`);return[`${a.join(`
`)}`,`var value = ${t.getByIndices("input_indices")};
var best_index : i32 = 0;`,`if (${t.getByIndices("input_indices")} ${e.selectLastIndex>0?"<=":"<"} value) {
         value = ${t.getByIndices("input_indices")};
         best_index = i32(last_index);
       }`,"",o.setByOffset("global_idx","best_index")]};r.compute(Fa("ArgMin",{hint:e.cacheKey,inputDependencies:["rank"]},[r.inputs[0]],n,[e.axis],7,e.keepDims),{inputs:[0]})},u0=(r,e)=>{a0(r.inputs);let n=(t,o,i)=>{let a=[];for(let s=0;s<t.rank;s++)(i.indexOf(s)>=0||i.length===0)&&a.push(`input_indices[${s}] = 0;`);return[`${a.join(`
`)}`,`var value = ${t.getByIndices("input_indices")};
var best_index : i32 = 0;`,`if (${t.getByIndices("input_indices")} ${e.selectLastIndex>0?">=":">"} value) {
         value = ${t.getByIndices("input_indices")};
         best_index = i32(last_index);
       }`,"",o.setByOffset("global_idx","best_index")]};r.compute(Fa("argMax",{hint:e.cacheKey,inputDependencies:["rank"]},[r.inputs[0]],n,[e.axis],7,e.keepDims),{inputs:[0]})},Oc=r=>de(r)});var Z3,Pc,J3,Y3,Q3,co,eE,c0,Wa=L(()=>{"use strict";ce();me();Ba();be();Z3=(r,e)=>{let n=r[0],t=r[1],o=r[2],i=r[3],a=r[4],s=r[5];if(a&&s)throw new Error("Attention cannot have both past and attention_bias");if(n.dims.length!==3)throw new Error('Input "input" must have 3 dimensions');let u=n.dims[0],l=n.dims[1],d=n.dims[2];if(o.dims.length!==1)throw new Error('Input "bias" is expected to have 1 dimensions');if(t.dims.length!==2)throw new Error('Input "weights" is expected to have 2 dimensions');if(t.dims[0]!==d)throw new Error("Input 1 dimension 0 should have same length as dimension 2 of input 0");if(o.dims[0]!==t.dims[1])throw new Error('Input "bias" dimension 0 should have same length as dimension 1 of input "weights"');let p=o.dims[0]/3,h=p,g=h;if(e.qkvHiddenSizes.length>0){if(e.qkvHiddenSizes.length!==3)throw new Error("qkv_hidden_sizes attribute should have 3 elements");for(let $ of e.qkvHiddenSizes)if($%e.numHeads!==0)throw new Error("qkv_hidden_sizes should be divisible by num_heads");p=e.qkvHiddenSizes[0],h=e.qkvHiddenSizes[1],g=e.qkvHiddenSizes[2]}let b=l;if(p!==h)throw new Error("qkv_hidden_sizes first element should be same as the second");if(o.dims[0]!==p+h+g)throw new Error('Input "bias" dimension 0 should have same length as sum of Q/K/V hidden sizes');let _=0;if(a){if(h!==g)throw new Error('Input "past" expect k_hidden_size == v_hidden_size');if(a.dims.length!==5)throw new Error('Input "past" must have 5 dimensions');if(a.dims[0]!==2)throw new Error('Input "past" first dimension must be 2');if(a.dims[1]!==u)throw new Error('Input "past" second dimension must be batch_size');if(a.dims[2]!==e.numHeads)throw new Error('Input "past" third dimension must be num_heads');if(a.dims[4]!==h/e.numHeads)throw new Error('Input "past" fifth dimension must be k_hidden_size / num_heads');e.pastPresentShareBuffer||(_=a.dims[3])}let S=b+_,v=-1,x=0;if(i)throw new Error("Mask not supported");if(a)throw new Error("past is not supported");if(s){if(s.dims.length!==4)throw new Error('Input "attention_bias" must have 4 dimensions');if(s.dims[0]!==u||s.dims[1]!==e.numHeads||s.dims[2]!==l||s.dims[3]!==S)throw new Error('Expect "attention_bias" shape (batch_size, num_heads, sequence_length, total_sequence_length)')}return{batchSize:u,sequenceLength:l,pastSequenceLength:_,kvSequenceLength:b,totalSequenceLength:S,maxSequenceLength:v,inputHiddenSize:d,hiddenSize:p,vHiddenSize:g,headSize:Math.floor(p/e.numHeads),vHeadSize:Math.floor(g/e.numHeads),numHeads:e.numHeads,isUnidirectional:!1,pastPresentShareBuffer:!1,maskFilterValue:e.maskFilterValue,maskType:x,scale:e.scale,broadcastResPosBias:!1,passPastInKv:!1,qkvFormat:1}},Pc=(r,e,n)=>e&&r?`
      let total_sequence_length_input = u32(${e.getByOffset("0")});
      let present_sequence_length = max(total_sequence_length_input, uniforms.past_sequence_length);
      let is_subsequent_prompt: bool = sequence_length > 1 && sequence_length != total_sequence_length_input;
      let is_first_prompt: bool = is_subsequent_prompt == false && sequence_length == total_sequence_length_input;
      total_sequence_length = u32(${r?.getByOffset("batchIdx")}) + 1;
      var past_sequence_length: u32 = 0;
      if (is_first_prompt == false) {
        past_sequence_length = total_sequence_length - sequence_length;
      }
       `:`
    ${n?"let past_sequence_length = uniforms.past_sequence_length":""};
    let present_sequence_length = total_sequence_length;
    `,J3=(r,e,n,t,o,i,a,s)=>{let u=Ce(a?1:i),l=64,d=i/u;d<l&&(l=32);let p=Math.ceil(i/u/l),h=[{type:12,data:e},{type:12,data:n},{type:12,data:t},{type:12,data:o},{type:12,data:d},{type:12,data:p}],g=Ue(r.dataType,u),b=lt(1,u),_=["type"];a&&_.push("type"),s&&_.push("type");let S=v=>{let x=H("x",r.dataType,r.dims,u),$=[x],O=a?M("seq_lens",a.dataType,a.dims):void 0;O&&$.push(O);let E=s?M("total_sequence_length_input",s.dataType,s.dims):void 0;E&&$.push(E);let D=lt(r.dataType),B=[{name:"batch_size",type:"u32"},{name:"num_heads",type:"u32"},{name:"past_sequence_length",type:"u32"},{name:"sequence_length",type:"u32"},{name:"total_sequence_length",type:"u32"},{name:"elements_per_thread",type:"u32"}];return`
  var<workgroup> thread_max: array<f32, ${l}>;
  var<workgroup> thread_sum: array<f32, ${l}>;
  ${v.registerUniforms(B).declareVariables(...$)}
  ${v.mainStart([l,1,1])}
    let batchIdx = workgroup_id.z / uniforms.num_heads;
    let headIdx = workgroup_id.z % uniforms.num_heads;
    let sequence_length = uniforms.sequence_length;
    var total_sequence_length = uniforms.total_sequence_length;
    ${Pc(O,E,!1)}
    let local_offset = local_idx * uniforms.elements_per_thread;
    let offset = (global_idx / ${l}) * uniforms.total_sequence_length + local_offset;
    let seq_causal_length = ${a?"u32(past_sequence_length + workgroup_id.y + 1)":"total_sequence_length"};
    var thread_max_vector = ${b}(-3.4028234663852886e+38f);
    for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
      thread_max_vector = max(${b}(x[offset + i]), thread_max_vector);
    }
    thread_max[local_idx] = ${(()=>{switch(u){case 1:return"thread_max_vector";case 2:return"max(thread_max_vector.x, thread_max_vector.y)";case 4:return"max(max(thread_max_vector.x, thread_max_vector.y), max(thread_max_vector.z, thread_max_vector.w))";default:throw new Error(`Unsupported components: ${u}`)}})()};
    workgroupBarrier();

    var max_value =  f32(-3.4028234663852886e+38f);
    for (var i = 0u; i < ${l}; i++) {
      max_value = max(thread_max[i], max_value);
    }

    var sum_vector = ${b}(0);
    for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
      sum_vector += exp(${b}(x[offset + i]) - max_value);
    }
    thread_sum[local_idx] = ${(()=>{switch(u){case 1:return"sum_vector";case 2:return"sum_vector.x + sum_vector.y";case 4:return"sum_vector.x + sum_vector.y + sum_vector.z + sum_vector.w";default:throw new Error(`Unsupported components: ${u}`)}})()};
    workgroupBarrier();

    var sum: f32 = 0;
    for (var i = 0u; i < ${l}; i++) {
      sum += thread_sum[i];
    }

    if (sum == 0) {
      for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
        x[offset + i] = ${x.type.value}(${D}(1.0) / ${D}(seq_causal_length));
      }
    } else {
      for (var i: u32 = 0; i < uniforms.elements_per_thread && i + local_offset < seq_causal_length; i++) {
        var f32input = ${b}(x[offset + i]);
        x[offset + i] = ${x.type.value}(exp(f32input - max_value) / sum);
      }
    }
      ${a?`
        for (var total_seq_id: u32 = seq_causal_length; total_seq_id + local_offset < uniforms.total_sequence_length; total_seq_id++) {
          x[offset + total_seq_id] = ${x.type.value}(${D}(0));
        }`:""};
  }`};return{name:"AttentionProbsSoftmax",shaderCache:{hint:`${l};${g};${u}`,inputDependencies:_},getShaderSource:S,getRunData:()=>({outputs:[],dispatchGroup:{x:1,y:o,z:e*n},programUniforms:h})}},Y3=(r,e,n,t,o,i,a,s,u)=>{let l=a+i.kvSequenceLength,d=[i.batchSize,i.numHeads,i.sequenceLength,l],p=r>1&&t,h=i.kvNumHeads?i.kvNumHeads:i.numHeads,g=p?[i.batchSize,h,l,i.headSize]:void 0,b=i.nReps?i.nReps:1,_=i.scale===0?1/Math.sqrt(i.headSize):i.scale,S=Ce(i.headSize),v=i.headSize/S,x=12,$={x:Math.ceil(l/x),y:Math.ceil(i.sequenceLength/x),z:i.batchSize*i.numHeads},O=[{type:12,data:i.sequenceLength},{type:12,data:v},{type:12,data:l},{type:12,data:i.numHeads},{type:12,data:i.headSize},{type:1,data:_},{type:12,data:a},{type:12,data:i.kvSequenceLength},{type:12,data:b}],E=p&&t&&k.size(t.dims)>0,D=["type","type"];E&&D.push("type"),o&&D.push("type"),s&&D.push("type"),u&&D.push("type");let B=[{dims:d,dataType:e.dataType,gpuDataType:0}];p&&B.push({dims:g,dataType:e.dataType,gpuDataType:0});let T=F=>{let W=M("q",e.dataType,e.dims,S),z=M("key",n.dataType,n.dims,S),te=[W,z];if(E){let oe=M("past_key",t.dataType,t.dims,S);te.push(oe)}o&&te.push(M("attention_bias",o.dataType,o.dims));let V=s?M("seq_lens",s.dataType,s.dims):void 0;V&&te.push(V);let w=u?M("total_sequence_length_input",u.dataType,u.dims):void 0;w&&te.push(w);let R=H("output",e.dataType,d),j=[R];p&&j.push(H("present_key",e.dataType,g,S));let J=lt(1,S),Z=[{name:"M",type:"u32"},{name:"K",type:"u32"},{name:"N",type:"u32"},{name:"num_heads",type:"u32"},{name:"head_size",type:"u32"},{name:"alpha",type:"f32"},{name:"past_sequence_length",type:"u32"},{name:"kv_sequence_length",type:"u32"},{name:"n_reps",type:"u32"}];return`
  const TILE_SIZE = ${x}u;

  var<workgroup> tileQ: array<${W.type.storage}, ${x*x}>;
  var<workgroup> tileK: array<${W.type.storage}, ${x*x}>;
  ${F.registerUniforms(Z).declareVariables(...te,...j)}
  ${F.mainStart([x,x,1])}
    // x holds the N and y holds the M
    let headIdx = workgroup_id.z % uniforms.num_heads;
    let kvHeadIdx = ${b===1?"headIdx":"headIdx / uniforms.n_reps"};
    let kv_num_heads = ${b===1?"uniforms.num_heads":"uniforms.num_heads / uniforms.n_reps"};
    let batchIdx = workgroup_id.z / uniforms.num_heads;
    let m = workgroup_id.y * TILE_SIZE;
    let n = workgroup_id.x * TILE_SIZE;
    let sequence_length = uniforms.M;
    var total_sequence_length = uniforms.N;
    ${Pc(V,w,!0)}
    let absKvHeadIdx = batchIdx * kv_num_heads + kvHeadIdx;
    let qOffset = workgroup_id.z * uniforms.M * uniforms.K + m * uniforms.K;
    ${E&&p?"let pastKeyOffset = absKvHeadIdx * uniforms.past_sequence_length * uniforms.K;":""};
    let kOffset = absKvHeadIdx * uniforms.kv_sequence_length * uniforms.K;
    ${p?"let presentKeyOffset = absKvHeadIdx * uniforms.N * uniforms.K;":""}
    var value = ${J}(0);
    for (var w: u32 = 0u; w < uniforms.K; w += TILE_SIZE) {
      if (global_id.y < uniforms.M && w + local_id.x < uniforms.K) {
        tileQ[TILE_SIZE * local_id.y + local_id.x] = q[qOffset + local_id.y * uniforms.K + w + local_id.x];
      }
      if (n + local_id.y < uniforms.N && w + local_id.x < uniforms.K) {
        var idx = TILE_SIZE * local_id.y + local_id.x;
      ${E&&p?`
              if (n + local_id.y < past_sequence_length) {
                tileK[idx] = past_key[pastKeyOffset + (n + local_id.y) * uniforms.K + w + local_id.x];
              } else if (n + local_id.y - past_sequence_length < uniforms.kv_sequence_length) {
                tileK[idx] = key[kOffset + (n + local_id.y - past_sequence_length) * uniforms.K + w + local_id.x];
              }`:`
          if (n + local_id.y < uniforms.kv_sequence_length) {
            tileK[idx] = key[kOffset + (n + local_id.y) * uniforms.K + w + local_id.x];
          }`}
      ${p?`if (n + local_id.y < present_sequence_length) {
        present_key[presentKeyOffset + (n + local_id.y) * uniforms.K + w + local_id.x] = tileK[idx];
      }`:""}
      }
      workgroupBarrier();

      for (var k: u32 = 0u; k < TILE_SIZE && w+k < uniforms.K; k++) {
          value += ${J}(tileQ[TILE_SIZE * local_id.y + k] * tileK[TILE_SIZE * local_id.x + k]);
      }

      workgroupBarrier();
    }

    if (global_id.y < uniforms.M && global_id.x < total_sequence_length) {
      let headOffset = workgroup_id.z * uniforms.M * uniforms.N;
      let outputIdx = headOffset + global_id.y * uniforms.N + global_id.x;
      var sum: f32 = ${(()=>{switch(S){case 1:return"value";case 2:return"value.x + value.y";case 4:return"value.x + value.y + value.z + value.w";default:throw new Error(`Unsupported components: ${S}`)}})()};
        output[outputIdx] = ${R.type.value} (sum * uniforms.alpha) + ${o?"attention_bias[outputIdx]":"0.0"};
    }
  }`};return{name:"AttentionProbs",shaderCache:{hint:`${S};${o!==void 0};${t!==void 0};${r}`,inputDependencies:D},getRunData:()=>({outputs:B,dispatchGroup:$,programUniforms:O}),getShaderSource:T}},Q3=(r,e,n,t,o,i,a=void 0,s=void 0)=>{let u=i+o.kvSequenceLength,l=o.nReps?o.nReps:1,d=o.vHiddenSize*l,p=r>1&&t,h=o.kvNumHeads?o.kvNumHeads:o.numHeads,g=p?[o.batchSize,h,u,o.headSize]:void 0,b=[o.batchSize,o.sequenceLength,d],_=12,S={x:Math.ceil(o.vHeadSize/_),y:Math.ceil(o.sequenceLength/_),z:o.batchSize*o.numHeads},v=[{type:12,data:o.sequenceLength},{type:12,data:u},{type:12,data:o.vHeadSize},{type:12,data:o.numHeads},{type:12,data:o.headSize},{type:12,data:d},{type:12,data:i},{type:12,data:o.kvSequenceLength},{type:12,data:l}],x=p&&t&&k.size(t.dims)>0,$=["type","type"];x&&$.push("type"),a&&$.push("type"),s&&$.push("type");let O=[{dims:b,dataType:e.dataType,gpuDataType:0}];p&&O.push({dims:g,dataType:e.dataType,gpuDataType:0});let E=D=>{let B=M("probs",e.dataType,e.dims),T=M("v",n.dataType,n.dims),F=[B,T];x&&F.push(M("past_value",t.dataType,t.dims));let W=a?M("seq_lens",a.dataType,a.dims):void 0;a&&F.push(W);let z=s?M("total_sequence_length_input",s.dataType,s.dims):void 0;s&&F.push(z);let V=[H("output",e.dataType,b)];p&&V.push(H("present_value",e.dataType,g));let w=[{name:"M",type:"u32"},{name:"K",type:"u32"},{name:"N",type:"u32"},{name:"num_heads",type:"u32"},{name:"head_size",type:"u32"},{name:"v_hidden_size",type:"u32"},{name:"past_sequence_length",type:"u32"},{name:"kv_sequence_length",type:"u32"},{name:"n_reps",type:"u32"}];return`
  const TILE_SIZE = ${_}u;
  var<workgroup> tileQ: array<${B.type.value}, ${_*_}>;
  var<workgroup> tileV: array<${B.type.value}, ${_*_}>;
  ${D.registerUniforms(w).declareVariables(...F,...V)}
  ${D.mainStart([_,_,1])}
   let headIdx = workgroup_id.z % uniforms.num_heads;
   let batchIdx = workgroup_id.z / uniforms.num_heads;
   let kvHeadIdx = ${l===1?"headIdx":"headIdx / uniforms.n_reps"};
   let kv_num_heads = ${l===1?"uniforms.num_heads":"uniforms.num_heads / uniforms.n_reps"};
   let m = global_id.y;
   let n = global_id.x;
   let sequence_length = uniforms.M;
   var total_sequence_length = uniforms.K;
   ${Pc(W,z,!0)}
   let offsetA = workgroup_id.z * uniforms.M * uniforms.K + m * uniforms.K;
   let absKvHeadIdx = batchIdx * kv_num_heads + kvHeadIdx; // kvHeadIdx is relative to the batch
   ${x&&p?"let pastValueOffset = absKvHeadIdx * uniforms.N * uniforms.past_sequence_length + n;":""};
   let vOffset = absKvHeadIdx * uniforms.N * uniforms.kv_sequence_length + n;
   ${p?"let presentValueOffset = absKvHeadIdx * uniforms.N * uniforms.K + n;":""}
   var value = ${B.type.storage}(0);
   for (var w: u32 = 0u; w < uniforms.K; w += TILE_SIZE) {
      if (m < uniforms.M && w + local_id.x < uniforms.K) {
        tileQ[TILE_SIZE * local_id.y + local_id.x] = probs[offsetA + w + local_id.x];
      }
      if (n < uniforms.N && w + local_id.y < uniforms.K) {
        var idx = TILE_SIZE * local_id.y + local_id.x;
        ${x&&p?`
        if (w + local_id.y < past_sequence_length) {
          tileV[idx] = past_value[pastValueOffset + (w + local_id.y) * uniforms.N];
        } else if (w + local_id.y - past_sequence_length < uniforms.kv_sequence_length) {
          tileV[idx] = v[vOffset + (w + local_id.y - past_sequence_length) * uniforms.N];
        }
      `:`
            if (w + local_id.y < uniforms.kv_sequence_length) {
              tileV[idx] = v[vOffset + (w + local_id.y) * uniforms.N];
            }`}
        ${p?`
            if (w + local_id.y < present_sequence_length) {
          present_value[presentValueOffset + (w + local_id.y) * uniforms.N] = tileV[idx];
        }`:""}
      }
     workgroupBarrier();
     for (var k: u32 = 0u; k < TILE_SIZE && w+k < total_sequence_length; k++) {
       value += tileQ[TILE_SIZE * local_id.y + k] * tileV[TILE_SIZE * k + local_id.x];
     }
     workgroupBarrier();
   }

   // we need to transpose output from BNSH_v to BSND_v
   if (m < uniforms.M && n < uniforms.N) {
     let outputIdx = batchIdx * uniforms.M * uniforms.v_hidden_size + m * uniforms.v_hidden_size
       + headIdx * uniforms.N + n;
     output[outputIdx] = value;
   }
  }`};return{name:"AttentionScore",shaderCache:{hint:`${t!==void 0};${r}`,inputDependencies:$},getRunData:()=>({outputs:O,dispatchGroup:S,programUniforms:v}),getShaderSource:E}},co=(r,e,n,t,o,i,a,s,u,l,d=void 0,p=void 0)=>{let h=Math.min(r.outputCount,1+(a?1:0)+(s?1:0)),g=h>1?a:void 0,b=h>1?s:void 0,_=h>1?l.pastSequenceLength:0,S=_+l.kvSequenceLength,v=u&&k.size(u.dims)>0?u:void 0,x=[e,n];g&&k.size(g.dims)>0&&x.push(g),v&&x.push(v),d&&x.push(d),p&&x.push(p);let $=r.compute(Y3(h,e,n,g,v,l,_,d,p),{inputs:x,outputs:h>1?[-1,1]:[-1]})[0];r.compute(J3($,l.batchSize,l.numHeads,_,l.sequenceLength,S,d,p),{inputs:d&&p?[$,d,p]:[$],outputs:[]});let O=[$,t];b&&k.size(b.dims)>0&&O.push(b),d&&O.push(d),p&&O.push(p),r.compute(Q3(h,$,t,b,l,_,d,p),{inputs:O,outputs:h>1?[0,2]:[0]})},eE=(r,e)=>{let n=[e.batchSize,e.numHeads,e.sequenceLength,e.headSize],t=e.sequenceLength,o=e.inputHiddenSize,i=e.headSize,a=12,s={x:Math.ceil(e.headSize/a),y:Math.ceil(e.sequenceLength/a),z:e.batchSize*e.numHeads},u=[r.inputs[0],r.inputs[1],r.inputs[2]],l=[{type:12,data:t},{type:12,data:o},{type:12,data:i},{type:12,data:e.numHeads},{type:12,data:e.headSize},{type:12,data:e.hiddenSize},{type:12,data:e.hiddenSize+e.hiddenSize+e.vHiddenSize}],d=p=>{let h=H("output_q",u[0].dataType,n),g=H("output_k",u[0].dataType,n),b=H("output_v",u[0].dataType,n),_=M("input",u[0].dataType,u[0].dims),S=M("weight",u[1].dataType,u[1].dims),v=M("bias",u[2].dataType,u[2].dims),x=_.type.storage,$=[{name:"M",type:"u32"},{name:"K",type:"u32"},{name:"N",type:"u32"},{name:"num_heads",type:"u32"},{name:"head_size",type:"u32"},{name:"hidden_size",type:"u32"},{name:"ldb",type:"u32"}];return`
  const TILE_SIZE = ${a}u;
  var<workgroup> tileInput: array<${x}, ${a*a}>;
  var<workgroup> tileWeightQ: array<${x}, ${a*a}>;
  var<workgroup> tileWeightK: array<${x}, ${a*a}>;
  var<workgroup> tileWeightV: array<${x}, ${a*a}>;
  ${p.registerUniforms($).declareVariables(_,S,v,h,g,b)}
  ${p.mainStart([a,a,1])}
    let batchIndex = workgroup_id.z / uniforms.num_heads;
    let headNumber = workgroup_id.z % uniforms.num_heads;
    let m = global_id.y;
    let n = global_id.x;

    let inputOffset = batchIndex * (uniforms.M * uniforms.K) + m * uniforms.K;
    let biasOffsetQ = headNumber * uniforms.head_size;
    let biasOffsetK = uniforms.hidden_size + biasOffsetQ;
    let biasOffsetV = uniforms.hidden_size + biasOffsetK;

    var valueQ = ${x}(0);
    var valueK = ${x}(0);
    var valueV = ${x}(0);
    for (var w: u32 = 0u; w < uniforms.K; w += TILE_SIZE) {
      if (m < uniforms.M && w + local_id.x < uniforms.K) {
        tileInput[TILE_SIZE * local_id.y + local_id.x] = input[inputOffset + w + local_id.x];
      }
      if (n < uniforms.N && w + local_id.y < uniforms.K) {
        let offset = n + (w + local_id.y) * uniforms.ldb;
        tileWeightQ[TILE_SIZE * local_id.y + local_id.x] = weight[biasOffsetQ + offset];
        tileWeightK[TILE_SIZE * local_id.y + local_id.x] = weight[biasOffsetK + offset];
        tileWeightV[TILE_SIZE * local_id.y + local_id.x] = weight[biasOffsetV + offset];
      }
      workgroupBarrier();
      for (var k: u32 = 0u; k<TILE_SIZE && w+k < uniforms.K; k++) {
        let inputTileOffset = TILE_SIZE * local_id.y + k;
        let weightTileOffset = TILE_SIZE * k + local_id.x;
        valueQ += tileInput[inputTileOffset] * tileWeightQ[weightTileOffset];
        valueK += tileInput[inputTileOffset] * tileWeightK[weightTileOffset];
        valueV += tileInput[inputTileOffset] * tileWeightV[weightTileOffset];
      }

      workgroupBarrier();
    }

    let headOffset = (m * uniforms.N + n) % uniforms.head_size;
    valueQ += bias[headOffset + biasOffsetQ];
    valueK += bias[headOffset + biasOffsetK];
    valueV += bias[headOffset + biasOffsetV];

    let offset = workgroup_id.z * uniforms.M * uniforms.N;
    if (m < uniforms.M && n < uniforms.N) {
      let outputIdx = offset + m * uniforms.N + n;
      output_q[outputIdx] = valueQ;
      output_k[outputIdx] = valueK;
      output_v[outputIdx] = valueV;
    }
  }`};return r.compute({name:"AttentionPrepare",shaderCache:{inputDependencies:["type","type","type"]},getRunData:()=>({outputs:[{dims:n,dataType:r.inputs[0].dataType,gpuDataType:0},{dims:n,dataType:r.inputs[0].dataType,gpuDataType:0},{dims:n,dataType:r.inputs[0].dataType,gpuDataType:0}],dispatchGroup:s,programUniforms:l}),getShaderSource:d},{inputs:u,outputs:[-1,-1,-1]})},c0=(r,e)=>{let n=Z3(r.inputs,e),[t,o,i]=eE(r,n);return co(r,t,o,i,r.inputs[4],void 0,void 0,void 0,r.inputs[5],n)}});var tE,nE,rE,d0,p0=L(()=>{"use strict";ht();ce();me();et();be();tE=(r,e)=>{if(!r||r.length!==5)throw new Error("BatchNormalization requires 5 inputs");let n=(t,o,i)=>{let a=o.length;if(a!==t.length)throw new Error(`${i}: num dimensions != ${a}`);o.forEach((s,u)=>{if(s!==t[u])throw new Error(`${i}: dim[${u}] do not match`)})};if(r[0].dims.length>1){let t=e.format==="NHWC"?e.spatial?r[0].dims.slice(-1):r[0].dims.slice(-1).concat(r[0].dims.slice(1,r[0].dims.length-1)):r[0].dims.slice(1,e.spatial?2:void 0);n(r[1].dims,t,"Invalid input scale"),n(r[2].dims,t,"Invalid input B"),n(r[3].dims,t,"Invalid input mean"),n(r[4].dims,t,"Invalid input var")}else n(r[1].dims,[1],"Invalid input scale"),n(r[2].dims,[1],"Invalid input B"),n(r[3].dims,[1],"Invalid input mean"),n(r[4].dims,[1],"Invalid input var")},nE=(r,e)=>{let{epsilon:n,spatial:t,format:o}=e,i=r[0].dims,a=t?Ce(i[i.length-1]):1,s=o==="NHWC"&&i.length>1?a:1,u=k.size(i)/a,l=t,d=l?i.length:i,p=M("x",r[0].dataType,r[0].dims,a),h=M("scale",r[1].dataType,r[1].dims,s),g=M("bias",r[2].dataType,r[2].dims,s),b=M("inputMean",r[3].dataType,r[3].dims,s),_=M("inputVar",r[4].dataType,r[4].dims,s),S=H("y",r[0].dataType,d,a),v=()=>{let $="";if(t)$=`let cOffset = ${i.length===1?"0u":o==="NHWC"?`outputIndices[${i.length-1}] / ${a}`:"outputIndices[1]"};`;else if(o==="NCHW")$=`
            ${S.indicesSet("outputIndices","0","0")}
            let cOffset = ${S.indicesToOffset("outputIndices")};`;else{$=`var cIndices = ${h.type.indices}(0);
                       cIndices[0] = outputIndices[${i.length-1}];`;for(let O=1;O<h.rank;O++)$+=`cIndices[${O}] = outputIndices[${O}];`;$+=`let cOffset = ${h.indicesToOffset("cIndices")};`}return $},x=$=>`
  const epsilon = ${n};
  ${$.registerUniform("outputSize","u32").declareVariables(p,h,g,b,_,S)}
  ${$.mainStart()}
  ${$.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
    var outputIndices = ${S.offsetToIndices(`global_idx * ${a}`)};
    ${v()}
    let scale = ${h.getByOffset("cOffset")};
    let bias = ${g.getByOffset("cOffset")};
    let inputMean = ${b.getByOffset("cOffset")};
    let inputVar = ${_.getByOffset("cOffset")};
    let x = ${p.getByOffset("global_idx")};
    let value = (x - inputMean) * inverseSqrt(inputVar + epsilon) * scale + bias;
    ${S.setByOffset("global_idx","value")}
  }`;return{name:"BatchNormalization",shaderCache:{hint:`${e.epsilon}_${e.format}_${t}_${a}`,inputDependencies:l?["rank","type","type","type","type"]:void 0},getShaderSource:x,getRunData:()=>({outputs:[{dims:r[0].dims,dataType:r[0].dataType}],dispatchGroup:{x:Math.ceil(u/64)},programUniforms:l?[{type:12,data:u},...K(i)]:[{type:12,data:u}]})}},rE=r=>de(r),d0=(r,e)=>{let{inputs:n,outputCount:t}=r,o=rE({...e,outputCount:t});if(he.webgpu.validateInputContent&&tE(n,o),e.trainingMode)throw new Error("BatchNormalization trainingMode is not supported yet.");r.compute(nE(n,o))}});var oE,iE,f0,h0=L(()=>{"use strict";me();be();oE=r=>{if(r[0].dims.length!==3)throw new Error("input should have 3 dimensions");if(![320,640,1280].includes(r[0].dims[2]))throw new Error("number of channels should be 320, 640 or 1280");if(r[1].dims.length!==1)throw new Error("bias is expected to have 1 dimensions");if(r[0].dims[2]!==r[1].dims[0])throw new Error("last dimension of input and bias are not the same")},iE=r=>{let e=r[0].dims,n=r[0].dims[2],t=k.size(e)/4,o=r[0].dataType,i=M("input",o,e,4),a=M("bias",o,[n],4),s=M("residual",o,e,4),u=H("output",o,e,4);return{name:"BiasAdd",getRunData:()=>({outputs:[{dims:e,dataType:r[0].dataType}],dispatchGroup:{x:Math.ceil(t/64)}}),getShaderSource:d=>`
  const channels = ${n}u / 4;
  ${d.declareVariables(i,a,s,u)}

  ${d.mainStart()}
    ${d.guardAgainstOutOfBoundsWorkgroupSizes(t)}
    let value = ${i.getByOffset("global_idx")}
      + ${a.getByOffset("global_idx % channels")} + ${s.getByOffset("global_idx")};
    ${u.setByOffset("global_idx","value")}
  }`}},f0=r=>{oE(r.inputs),r.compute(iE(r.inputs))}});var aE,ze,m0,g0,b0,y0,_0,w0,v0,x0,T0,sE,I0,S0,$0,A0,Ho,O0,Ha,P0,E0,C0,D0,k0,N0,L0,R0,z0,M0,B0,V0,G0,U0,F0,W0,H0,q0,Ec,Cc,j0,K0,X0,uE,lE,Z0,qa=L(()=>{"use strict";ce();me();et();be();aE=(r,e,n,t,o,i,a)=>{let s=Math.ceil(e/4),u="";typeof o=="string"?u=`${o}(a)`:u=o("a");let l=M("inputData",n,[s],4),d=H("outputData",t,[s],4),p=[{name:"vec_size",type:"u32"}];return a&&p.push(...a),`
      ${r.registerUniforms(p).declareVariables(l,d)}

  ${i??""}

  ${r.mainStart()}
    ${r.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}

    let a = ${l.getByOffset("global_idx")};
    ${d.setByOffset("global_idx",u)}
  }`},ze=(r,e,n,t,o,i=r.dataType,a,s)=>{let u=[{type:12,data:Math.ceil(k.size(r.dims)/4)}];return a&&u.push(...a),{name:e,shaderCache:{hint:o,inputDependencies:["type"]},getShaderSource:l=>aE(l,k.size(r.dims),r.dataType,i,n,t,s),getRunData:l=>({outputs:[{dims:r.dims,dataType:i}],dispatchGroup:{x:Math.ceil(k.size(l[0].dims)/64/4)},programUniforms:u})}},m0=r=>{r.compute(ze(r.inputs[0],"Abs","abs"))},g0=r=>{r.compute(ze(r.inputs[0],"Acos","acos"))},b0=r=>{r.compute(ze(r.inputs[0],"Acosh","acosh"))},y0=r=>{r.compute(ze(r.inputs[0],"Asin","asin"))},_0=r=>{r.compute(ze(r.inputs[0],"Asinh","asinh"))},w0=r=>{r.compute(ze(r.inputs[0],"Atan","atan"))},v0=r=>{r.compute(ze(r.inputs[0],"Atanh","atanh"))},x0=r=>de(r),T0=(r,e)=>{let n;switch(e.to){case 10:n="vec4<f16>";break;case 1:n="vec4<f32>";break;case 12:n="vec4<u32>";break;case 6:n="vec4<i32>";break;case 9:n="vec4<bool>";break;default:throw new RangeError(`not supported type (specified in attribute 'to' from 'Cast' operator): ${e.to}`)}r.compute(ze(r.inputs[0],"Cast",n,void 0,e.cacheKey,e.to))},sE=r=>{let e,n,t=r.length>=2&&r[1].data!==0,o=r.length>=3&&r[2].data!==0;switch(r[0].dataType){case 1:e=t?r[1].getFloat32Array()[0]:-34028234663852886e22,n=o?r[2].getFloat32Array()[0]:34028234663852886e22;break;case 10:e=t?r[1].getUint16Array()[0]:64511,n=o?r[2].getUint16Array()[0]:31743;break;default:throw new Error("Unsupport data type")}return de({min:e,max:n})},I0=(r,e)=>{let n=e||sE(r.inputs),t=lt(r.inputs[0].dataType);r.compute(ze(r.inputs[0],"Clip",o=>`clamp(${o}, vec4<${t}>(uniforms.min), vec4<${t}>(uniforms.max))`,void 0,n.cacheKey,void 0,[{type:r.inputs[0].dataType,data:n.min},{type:r.inputs[0].dataType,data:n.max}],[{name:"min",type:t},{name:"max",type:t}]),{inputs:[0]})},S0=r=>{r.compute(ze(r.inputs[0],"Ceil","ceil"))},$0=r=>{r.compute(ze(r.inputs[0],"Cos","cos"))},A0=r=>{r.compute(ze(r.inputs[0],"Cosh","cosh"))},Ho=r=>de(r),O0=(r,e)=>{let n=lt(r.inputs[0].dataType);r.compute(ze(r.inputs[0],"Elu",t=>`elu_vf32(${t})`,`
  const elu_alpha_ = ${n}(${e.alpha});

  fn elu_f32(a: ${n}) -> ${n} {
  return select((exp(a) - 1.0) * elu_alpha_, a, a >= 0.0);
  }

  fn elu_vf32(v: vec4<${n}>) -> vec4<${n}> {
  return vec4(elu_f32(v.x), elu_f32(v.y), elu_f32(v.z), elu_f32(v.w));
  }`,e.cacheKey))},Ha=(r="f32")=>`
const r0: ${r} = 0.3275911;
const r1: ${r} = 0.254829592;
const r2: ${r} = -0.284496736;
const r3: ${r} = 1.421413741;
const r4: ${r} = -1.453152027;
const r5: ${r} = 1.061405429;

fn erf_vf32(v: vec4<${r}>) -> vec4<${r}> {
  let absv = abs(v);
  let x = 1.0 / (1.0 + r0 * absv);
  return sign(v) * (1.0 - ((((r5 * x + r4) * x + r3) * x + r2) * x + r1) * x * exp(-absv * absv));
}`,P0=r=>{let e=lt(r.inputs[0].dataType);r.compute(ze(r.inputs[0],"Erf",n=>`erf_vf32(${n})`,Ha(e)))},E0=r=>{r.compute(ze(r.inputs[0],"Exp","exp"))},C0=r=>{r.compute(ze(r.inputs[0],"Floor","floor"))},D0=r=>{let e=lt(r.inputs[0].dataType);r.compute(ze(r.inputs[0],"Gelu",n=>`0.5 * ${n} * (1.0 + erf_vf32(${n} * 0.7071067811865475))`,Ha(e)))},k0=(r,e)=>{let n=lt(r.inputs[0].dataType);r.compute(ze(r.inputs[0],"LeakyRelu",t=>`select(leaky_relu_alpha_ * ${t}, ${t}, ${t} >= vec4<${n}>(0.0))`,`const leaky_relu_alpha_ = ${n}(${e.alpha});`,e.cacheKey))},N0=r=>{r.compute(ze(r.inputs[0],"Not",e=>`!${e}`))},L0=r=>{r.compute(ze(r.inputs[0],"Neg",e=>`-${e}`))},R0=r=>{r.compute(ze(r.inputs[0],"Reciprocal",e=>`1.0/${e}`))},z0=r=>{let e=lt(r.inputs[0].dataType);r.compute(ze(r.inputs[0],"Relu",n=>`select(vec4<${e}>(0.0), ${n}, ${n} > vec4<${e}>(0.0))`))},M0=r=>{r.compute(ze(r.inputs[0],"Sigmoid",e=>`(1.0 / (1.0 + exp(-${e})))`))},B0=r=>de(r),V0=(r,e)=>{let n=lt(r.inputs[0].dataType);r.compute(ze(r.inputs[0],"HardSigmoid",t=>`max(vec4<${n}>(0.0), min(vec4<${n}>(1.0), ${e.alpha} * ${t} + vec4<${n}>(${e.beta})))`,void 0,e.cacheKey))},G0=r=>{r.compute(ze(r.inputs[0],"Sin","sin"))},U0=r=>{r.compute(ze(r.inputs[0],"Sinh","sinh"))},F0=r=>{r.compute(ze(r.inputs[0],"Sqrt","sqrt"))},W0=r=>{r.compute(ze(r.inputs[0],"Tan","tan"))},H0=r=>`sign(${r}) * (1 - exp(-2 * abs(${r}))) / (1 + exp(-2 * abs(${r})))`,q0=r=>{r.compute(ze(r.inputs[0],"Tanh",H0))},Ec=(r="f32")=>`
const fast_gelu_a: ${r} = 0.5;
const fast_gelu_b: ${r} = 0.7978845608028654;
const fast_gelu_c: ${r} = 0.035677408136300125;

fn tanh_v(v: vec4<${r}>) -> vec4<${r}> {
  return ${H0("v")};
}
`,Cc=r=>`(fast_gelu_a + fast_gelu_a * tanh_v(${r} * (fast_gelu_c * ${r} * ${r} + fast_gelu_b))) * ${r}`,j0=r=>{let e=lt(r.inputs[0].dataType);r.compute(ze(r.inputs[0],"FastGelu",Cc,Ec(e),void 0,r.inputs[0].dataType))},K0=(r,e)=>{let n=lt(r.inputs[0].dataType);return r.compute(ze(r.inputs[0],"ThresholdedRelu",t=>`select(vec4<${n}>(0.0), ${t}, ${t} > thresholded_relu_alpha_)`,`const thresholded_relu_alpha_ = vec4<${n}>(${e.alpha});`,e.cacheKey)),0},X0=r=>{r.compute(ze(r.inputs[0],"Log","log"))},uE=(r,e)=>`
const alpha = vec4<${r}>(${e});
const one = ${r}(1.0);
const zero = ${r}(0.0);

fn quick_gelu_impl(x: vec4<${r}>) -> vec4<${r}> {
  let v = x *alpha;
  var x1 : vec4<${r}>;
  for (var i = 0; i < 4; i = i + 1) {
    if (v[i] >= zero) {
      x1[i] = one / (one + exp(-v[i]));
    } else {
      x1[i] = one - one / (one + exp(v[i]));
    }
  }
  return x * x1;
}
`,lE=r=>`quick_gelu_impl(${r})`,Z0=(r,e)=>{let n=lt(r.inputs[0].dataType);r.compute(ze(r.inputs[0],"QuickGelu",lE,uE(n,e.alpha),e.cacheKey,r.inputs[0].dataType))}});var cE,dE,Y0,Q0=L(()=>{"use strict";me();be();qa();cE=r=>{if(r[0].dims.length!==3)throw new Error("input should have 3 dimensions");if(![2560,5120,10240].includes(r[0].dims[2]))throw new Error("hidden state should be 2560, 5120 or 10240");if(r[1].dims.length!==1)throw new Error("bias is expected to have 1 dimensions");if(r[0].dims[2]!==r[1].dims[0])throw new Error("last dimension of input and bias are not the same")},dE=r=>{let e=r[0].dims.slice();e[2]=e[2]/2;let n=M("input",r[0].dataType,r[0].dims,4),t=M("bias",r[0].dataType,[r[0].dims[2]],4),o=H("output",r[0].dataType,e,4),i=k.size(e)/4,a=Ue(r[0].dataType);return{name:"BiasSplitGelu",getRunData:()=>({outputs:[{dims:e,dataType:r[0].dataType}],dispatchGroup:{x:Math.ceil(i/64)}}),getShaderSource:u=>`
  const M_SQRT2 = sqrt(2.0);
  const halfChannels = ${r[0].dims[2]/4/2}u;

  ${u.declareVariables(n,t,o)}

  ${Ha(a)}

  ${u.mainStart()}
    ${u.guardAgainstOutOfBoundsWorkgroupSizes(i)}
    let biasIdx = global_idx % halfChannels;
    let batchIndex = global_idx / halfChannels;
    let inputOffset = biasIdx + batchIndex * halfChannels * 2;
    let valueLeft = input[inputOffset] + bias[biasIdx];
    let valueRight = input[inputOffset + halfChannels] + bias[biasIdx + halfChannels];
    let geluRight = valueRight * 0.5 * (erf_vf32(valueRight / M_SQRT2) + 1);

    ${o.setByOffset("global_idx","valueLeft * geluRight")}
  }`}},Y0=r=>{cE(r.inputs),r.compute(dE(r.inputs))}});var pE,fE,Kn,ew,tw,nw,rw,ow,iw,aw,sw,uw,lw,cw=L(()=>{"use strict";ce();me();be();pE=(r,e,n,t,o,i,a,s,u,l,d,p)=>{let h,g;typeof s=="string"?h=g=(x,$)=>`${s}((${x}),(${$}))`:typeof s=="function"?h=g=s:(h=s.scalar,g=s.vector);let b=H("outputData",d,t.length,4),_=M("aData",u,e.length,4),S=M("bData",l,n.length,4),v;if(o)if(i){let x=k.size(e)===1,$=k.size(n)===1,O=e.length>0&&e[e.length-1]%4===0,E=n.length>0&&n[n.length-1]%4===0;x||$?v=b.setByOffset("global_idx",g(x?`${_.type.value}(${_.getByOffset("0")}.x)`:_.getByOffset("global_idx"),$?`${S.type.value}(${S.getByOffset("0")}.x)`:S.getByOffset("global_idx"))):v=`
            let outputIndices = ${b.offsetToIndices("global_idx * 4u")};
            let offsetA = ${_.broadcastedIndicesToOffset("outputIndices",b)};
            let offsetB = ${S.broadcastedIndicesToOffset("outputIndices",b)};
            ${b.setByOffset("global_idx",g(a||O?_.getByOffset("offsetA / 4u"):`${_.type.value}(${_.getByOffset("offsetA / 4u")}[offsetA % 4u])`,a||E?S.getByOffset("offsetB / 4u"):`${S.type.value}(${S.getByOffset("offsetB / 4u")}[offsetB % 4u])`))}
          `}else v=b.setByOffset("global_idx",g(_.getByOffset("global_idx"),S.getByOffset("global_idx")));else{if(!i)throw new Error("no necessary to use scalar implementation for element-wise binary op implementation.");let x=($,O,E="")=>{let D=`aData[indexA${O}][componentA${O}]`,B=`bData[indexB${O}][componentB${O}]`;return`
            let outputIndices${O} = ${b.offsetToIndices(`global_idx * 4u + ${O}u`)};
            let offsetA${O} = ${_.broadcastedIndicesToOffset(`outputIndices${O}`,b)};
            let offsetB${O} = ${S.broadcastedIndicesToOffset(`outputIndices${O}`,b)};
            let indexA${O} = offsetA${O} / 4u;
            let indexB${O} = offsetB${O} / 4u;
            let componentA${O} = offsetA${O} % 4u;
            let componentB${O} = offsetB${O} % 4u;
            ${$}[${O}] = ${E}(${h(D,B)});
          `};d===9?v=`
            var data = vec4<u32>(0);
            ${x("data",0,"u32")}
            ${x("data",1,"u32")}
            ${x("data",2,"u32")}
            ${x("data",3,"u32")}
            outputData[global_idx] = dot(vec4<u32>(0x1, 0x100, 0x10000, 0x1000000), vec4<u32>(data));`:v=`
            ${x("outputData[global_idx]",0)}
            ${x("outputData[global_idx]",1)}
            ${x("outputData[global_idx]",2)}
            ${x("outputData[global_idx]",3)}
          `}return`
        ${r.registerUniform("vec_size","u32").declareVariables(_,S,b)}

        ${p??""}

        ${r.mainStart()}
        ${r.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}
        ${v}
      }`},fE=(r,e,n,t,o,i,a=n.dataType)=>{let s=n.dims.map(Number),u=t.dims.map(Number),l=!k.areEqual(s,u),d=s,p=k.size(s),h=!1,g=!1,b=[l];if(l){let _=Fn.calcShape(s,u,!1);if(!_)throw new Error("Can't perform binary op on the given tensors");d=_.slice(),p=k.size(d);let S=k.size(s)===1,v=k.size(u)===1,x=s.length>0&&s[s.length-1]%4===0,$=u.length>0&&u[u.length-1]%4===0;b.push(S),b.push(v),b.push(x),b.push($);let O=1;for(let E=1;E<d.length;E++){let D=s[s.length-E],B=u[u.length-E];if(D===B)O*=D;else break}O%4===0?(g=!0,h=!0):(S||v||x||$)&&(h=!0)}else h=!0;return b.push(h),{name:r,shaderCache:{hint:e+b.map(_=>_.toString()).join("_"),inputDependencies:["rank","rank"]},getShaderSource:_=>pE(_,s,u,d,h,l,g,o,n.dataType,t.dataType,a,i),getRunData:()=>({outputs:[{dims:d,dataType:a}],dispatchGroup:{x:Math.ceil(p/64/4)},programUniforms:[{type:12,data:Math.ceil(k.size(d)/4)},...K(s,u,d)]})}},Kn=(r,e,n,t,o,i)=>{r.compute(fE(e,o??"",r.inputs[0],r.inputs[1],n,t,i))},ew=r=>{Kn(r,"Add",(e,n)=>`${e}+${n}`)},tw=r=>{Kn(r,"Div",(e,n)=>`${e}/${n}`)},nw=r=>{Kn(r,"Equal",{scalar:(e,n)=>`u32(${e}==${n})`,vector:(e,n)=>`vec4<u32>(${e}==${n})`},void 0,void 0,9)},rw=r=>{Kn(r,"Mul",(e,n)=>`${e}*${n}`)},ow=r=>{let e=M("input",r.inputs[0].dataType,r.inputs[0].dims).type.value;Kn(r,"Pow",{scalar:(t,o)=>`pow_custom(${t},${o})`,vector:(t,o)=>`pow_vector_custom(${t},${o})`},`
    fn pow_custom(a : ${e}, b : ${e}) -> ${e} {
      if (b == ${e}(0.0)) {
        return ${e}(1.0);
      } else if (a < ${e}(0.0) && f32(b) != floor(f32(b))) {
        return ${e}(pow(f32(a), f32(b))); // NaN
      }
      return select(sign(a), ${e}(1.0), round(f32(abs(b) % ${e}(2.0))) != 1.0) * ${e}(${e==="i32"?"round":""}(pow(f32(abs(a)), f32(b))));
    }
    fn pow_vector_custom(a : vec4<${e}>, b : vec4<${e}>) -> vec4<${e}> {
      // TODO: implement vectorized pow
      return vec4<${e}>(pow_custom(a.x, b.x), pow_custom(a.y, b.y), pow_custom(a.z, b.z), pow_custom(a.w, b.w));
    }
      `)},iw=r=>{Kn(r,"Sub",(e,n)=>`${e}-${n}`)},aw=r=>{Kn(r,"Greater",{scalar:(e,n)=>`u32(${e}>${n})`,vector:(e,n)=>`vec4<u32>(${e}>${n})`},void 0,void 0,9)},sw=r=>{Kn(r,"Less",{scalar:(e,n)=>`u32(${e}<${n})`,vector:(e,n)=>`vec4<u32>(${e}<${n})`},void 0,void 0,9)},uw=r=>{Kn(r,"GreaterOrEqual",{scalar:(e,n)=>`u32(${e}>=${n})`,vector:(e,n)=>`vec4<u32>(${e}>=${n})`},void 0,void 0,9)},lw=r=>{Kn(r,"LessOrEqual",{scalar:(e,n)=>`u32(${e}<=${n})`,vector:(e,n)=>`vec4<u32>(${e}<=${n})`},void 0,void 0,9)}});var mE,gE,bE,yE,dw,pw,fw=L(()=>{"use strict";ce();me();et();be();mE=(r,e)=>{if(!r||r.length<1)throw new Error("too few inputs");let n=0,t=r[n],o=t.dataType,i=t.dims.length;r.forEach((a,s)=>{if(s!==n){if(a.dataType!==o)throw new Error("input tensors should be one type");if(a.dims.length!==i)throw new Error("input tensors should have the same shape");a.dims.forEach((u,l)=>{if(l!==e&&u!==t.dims[l])throw new Error("non concat dimensions must match")})}})},gE=(r,e)=>`
  fn calculateInputIndex(index: u32) -> u32 {
    let sizeInConcatAxis = array<u32, ${r}u>(${e});
    for (var i: u32 = 0u; i < ${r}; i += 1u ) {
      if (index < sizeInConcatAxis[i]) {
        return i;
      }
    }
    return ${r}u;
  }`,bE=(r,e)=>{let n=r.length,t=[];for(let o=0;o<n;++o){let i=e.setByOffset("global_idx",r[o].getByIndices("indices"));n===1?t.push(i):o===0?t.push(`if (inputIndex == ${o}u) { ${i} }`):o===n-1?t.push(`else { ${i} }`):t.push(`else if (inputIndex == ${o}) { ${i} }`)}return t.join(`
`)},yE=(r,e,n,t)=>{let o=k.size(n),i=new Array(r.length),a=new Array(r.length),s=0,u=[],l=[],d=[{type:12,data:o}];for(let _=0;_<r.length;++_)s+=r[_].dims[e],i[_]=s,l.push(r[_].dims.length),a[_]=M(`input${_}`,t,l[_]),u.push("rank"),d.push({type:12,data:i[_]});for(let _=0;_<r.length;++_)d.push(...K(r[_].dims));d.push(...K(n));let p=H("output",t,n.length),h=p.indicesGet("indices",e),g=Array.from(Array(i.length).keys()).map(_=>`uniforms.sizeInConcatAxis${_}`).join(","),b=_=>`

  ${(()=>{_.registerUniform("outputSize","u32");for(let S=0;S<r.length;S++)_.registerUniform(`sizeInConcatAxis${S}`,"u32");return _.declareVariables(...a,p)})()}

  ${gE(i.length,g)}

  ${_.mainStart()}
    ${_.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}

    var indices = ${p.offsetToIndices("global_idx")};

    let inputIndex = calculateInputIndex(${h});
    if (inputIndex != 0u) {
      let sizeInConcatAxis = array<u32, ${i.length}u>(${g});
      ${h} -= sizeInConcatAxis[inputIndex - 1u];
    }

    ${bE(a,p)}
  }`;return{name:"Concat",shaderCache:{hint:`${e}`,inputDependencies:u},getRunData:()=>({outputs:[{dims:n,dataType:t}],dispatchGroup:{x:Math.ceil(o/64)},programUniforms:d}),getShaderSource:b}},dw=(r,e)=>{let n=r.inputs,t=n[0].dims,o=k.normalizeAxis(e.axis,t.length);mE(n,o);let i=t.slice();i[o]=n.reduce((s,u)=>s+(u.dims.length>o?u.dims[o]:0),0);let a=n.filter(s=>k.size(s.dims)>0);r.compute(yE(a,o,i,n[0].dataType),{inputs:a})},pw=r=>de({axis:r.axis})});var Jt,Yt,Qt,ja,_r=L(()=>{"use strict";ce();me();Jt=(r,e,n="f32")=>{switch(r.activation){case"Relu":return`value = max(value, ${e}(0.0));`;case"Sigmoid":return`value = (${e}(1.0) / (${e}(1.0) + exp(-value)));`;case"Clip":return`value = clamp(value, ${e}(${n}(uniforms.clip_min)), ${e}(${n}(uniforms.clip_max)));`;case"HardSigmoid":return`value = max(${e}(0.0), min(${e}(1.0), ${n}(uniforms.alpha) * value + ${n}(uniforms.beta)));`;case"LeakyRelu":return`value = select(${n}(uniforms.alpha) * value, value, value >= ${e}(0.0));`;case"Tanh":return`let e2x = exp(-2.0 * abs(value));
              value = sign(value) * (1.0 - e2x) / (1.0 + e2x);
        `;case"":return"";default:throw new Error(`Unsupported activation ${r.activation}`)}},Yt=(r,e)=>{r.activation==="Clip"?e.push({type:1,data:r.clipMax},{type:1,data:r.clipMin}):r.activation==="HardSigmoid"?e.push({type:1,data:r.alpha},{type:1,data:r.beta}):r.activation==="LeakyRelu"&&e.push({type:1,data:r.alpha})},Qt=(r,e)=>{r.activation==="Clip"?e.push({name:"clip_max",type:"f32"},{name:"clip_min",type:"f32"}):r.activation==="HardSigmoid"?e.push({name:"alpha",type:"f32"},{name:"beta",type:"f32"}):r.activation==="LeakyRelu"&&e.push({name:"alpha",type:"f32"})},ja=r=>{let e=r?.activation||"";if(e==="HardSigmoid"){let[n,t]=r?.activation_params||[.2,.5];return{activation:e,alpha:n,beta:t}}else if(e==="Clip"){let[n,t]=r?.activation_params||[w_,v_];return{activation:e,clipMax:t,clipMin:n}}else if(e==="LeakyRelu"){let[n]=r?.activation_params||[.01];return{activation:e,alpha:n}}return{activation:e}}});var at,hw,Ka=L(()=>{"use strict";at=(r,e)=>{switch(r){case 1:return e;case 2:return`vec2<${e}>`;case 3:return`vec3<${e}>`;case 4:return`vec4<${e}>`;default:throw new Error(`${r}-component is not supported.`)}},hw=r=>`
      ${r?"value = value + getBiasByOutputCoords(coords);":""}
      `});var mw,gw=L(()=>{"use strict";mw=r=>`
fn getIndexFromCoords4D(coords : vec4<i32>, shape : vec4<i32>) -> i32 {
  return dot(coords, vec4<i32>(
      shape.y * shape.z * shape.w, shape.z * shape.w, shape.w, 1));
}
fn getOutputIndexFromCoords(coords : vec4<i32>) -> i32 {
  return dot(coords, vec4<i32>(
    i32(${r}.x), i32(${r}.y), i32(${r}.z), 1));
}
`});var qo,Xa,Za=L(()=>{"use strict";ce();me();be();_r();qo=(r,e,n,t,o)=>{let i=t-n;return`
      ${Array.from({length:n}).map((a,s)=>`
      if (${re(e.shape,s,e.rank)} != 1) {
        ${e.indicesSet(r,s,re(o,s+i,t))}
      } else {
        ${e.indicesSet(r,s,0)}
      }`).join("")}
`},Xa=(r,e,n,t,o=!1,i)=>{let a=r[0].dims,s=r[1].dims,u=a[a.length-2],l=s[s.length-1],d=a[a.length-1],p=Ce(l),h=Ce(d),g=Ce(u),b=k.size(n)/p/g,_=r.length>2,S=t?t.slice(0,-2):n.slice(0,-2),x=[k.size(S),u,l],$=[{type:12,data:b},{type:12,data:u},{type:12,data:l},{type:12,data:d}];Yt(e,$),$.push(...K(S,a,s)),_&&$.push(...K(r[2].dims)),$.push(...K(x));let O=E=>{let D=Ga("batch_dims",r[0].dataType,S.length),B=M("a",r[0].dataType,a.length,h),T=M("b",r[1].dataType,s.length,p),F=H("output",r[0].dataType,x.length,p),W=Ue(F.type.tensor),z=Jt(e,F.type.value,W),te=[B,T],V="";if(_){let j=o?p:1;te.push(M("bias",r[2].dataType,r[2].dims.length,j)),V=`${o?`value += bias[col / ${j}];`:`value += ${F.type.value}(bias[row + i]);`}`}let w=[{name:"output_size",type:"u32"},{name:"M",type:"u32"},{name:"N",type:"u32"},{name:"K",type:"u32"}];Qt(e,w);let R=()=>{let j=`var a_data: ${B.type.value};`;for(let J=0;J<h;J++)j+=`
              let b_data${J} = b[(b_offset + (k + ${J}) * uniforms.N + col) / ${p}];`;for(let J=0;J<g;J++){j+=`a_data = a[(a_offset + (row + ${J}) * uniforms.K + k) / ${h}];`;for(let Z=0;Z<h;Z++)j+=`
            values[${J}] = fma(${T.type.value}(a_data${h===1?"":`[${Z}]`}), b_data${Z}, values[${J}]);
`}return j};return`
  ${E.registerUniforms(w).registerInternalVariables(D).declareVariables(...te,F)}
  ${E.mainStart()}
    ${E.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let col = (global_idx % (uniforms.N / ${p})) * ${p};
    var index1 = global_idx / (uniforms.N / ${p});
    let stride1 = uniforms.M / ${g};
    let row = (index1 % stride1) * ${g};
    let batch = index1 / stride1;

    ${n.length===2?"":`let batch_indices = ${D.offsetToIndices("batch")};`}

    var a_indices: ${B.type.indices};
    ${qo("a_indices",B,B.rank-2,D.rank,"batch_indices")}
    ${B.indicesSet("a_indices",B.rank-2,0)}
    ${B.indicesSet("a_indices",B.rank-1,0)}
    let a_offset = ${B.indicesToOffset("a_indices")};

    var b_indices: ${T.type.indices};
    ${qo("b_indices",T,T.rank-2,D.rank,"batch_indices")}
    ${T.indicesSet("b_indices",T.rank-2,0)}
    ${T.indicesSet("b_indices",T.rank-1,0)}
    let b_offset = ${T.indicesToOffset("b_indices")};
    var values: array<${F.type.value}, ${g}>;
    for (var k: u32 = 0u; k < uniforms.K; k = k + ${h}) {
      ${R()}
    }
    for (var i = 0u; i < ${g}u; i++) {
      var value = values[i];
      ${V}
      ${z}
      let cur_indices = ${F.type.indices}(batch, row + i, col);
      let offset = ${F.indicesToOffset("cur_indices")};
      ${F.setByOffset(`offset / ${p}`,"value")};
    }
  }
  `};return{name:"MatMulNaive",shaderCache:{hint:`${e.activation};${p};${h};${g};${o}`,inputDependencies:_?["rank","rank","rank"]:["rank","rank"]},getRunData:()=>({outputs:[{dims:i?i(n):n,dataType:r[0].dataType}],dispatchGroup:{x:Math.ceil(b/64)},programUniforms:$}),getShaderSource:O}}});var _E,wE,Dc,bw,vE,kc,xE,jo,Ja=L(()=>{"use strict";ce();me();be();_r();Za();Ka();_E=(r,e)=>r?`
        mm_Asub[inputRow][inputCol] = mm_readA(batch,
          kStart + inputRow,
          globalRowStart / innerElementSize + inputCol${e?", batchIndices":""});
        `:`
        mm_Asub[inputRow][inputCol] = mm_readA(batch,
          globalRow + innerRow,
          kStart / innerElementSize + inputCol${e?", batchIndices":""});
        `,wE=(r,e)=>r?`
        let ACached0 = mm_Asub[k * innerElementSize][localRow];
        let ACached1 = mm_Asub[k * innerElementSize + 1][localRow];
        let ACached2 = mm_Asub[k * innerElementSize + 2][localRow];
        ${e===3?"":"let ACached3 = mm_Asub[k * innerElementSize + 3][localRow];"}
        for (var i = 0; i < rowPerThread; i = i + 1) {
          acc[i] = BCached0 * ACached0[i] + acc[i];
          acc[i] = BCached1 * ACached1[i] + acc[i];
          acc[i] = BCached2 * ACached2[i] + acc[i];
          ${e===3?"":"acc[i] = BCached3 * ACached3[i] + acc[i];"}
        }`:`
        for (var i = 0; i < rowPerThread; i = i + 1) {
          let ACached = mm_Asub[tileRow + i][k];
          acc[i] = BCached0 * ACached.x + acc[i];
          acc[i] = BCached1 * ACached.y + acc[i];
          acc[i] = BCached2 * ACached.z + acc[i];
          ${e===3?"":"acc[i] = BCached3 * ACached.w + acc[i];"}
        }`,Dc=(r,e,n="f32",t,o=!1,i=32,a=!1,s=32)=>{let u=e[1]*r[1],l=e[0]*r[0],d=o?u:i,p=o?i:u,h=d/e[0],g=i/e[1];if(!((o&&h===4&&r[1]===4||!o&&(h===3||h===4))&&d%e[0]===0&&i%e[1]===0&&r[0]===4))throw new Error(`If transposeA ${o} is true, innerElementSize ${h} and workPerThread[1] ${r[1]} must be 4.
      Otherwise, innerElementSize ${h} must be 3 or 4.
  tileAWidth ${d} must be divisible by workgroupSize[0]${e[0]}. tileInner ${i} must be divisible by workgroupSize[1] ${e[1]}. colPerThread ${r[0]} must be 4.`);return`
var<workgroup> mm_Asub: array<array<vec${h}<${n}>, ${d/h}>, ${p}>;
var<workgroup> mm_Bsub: array<array<vec4<${n}>, ${l/r[0]}>, ${i}>;

const rowPerThread = ${r[1]};
const colPerThread = ${r[0]};
const innerElementSize = ${h};
const tileInner = ${i};

@compute @workgroup_size(${e[0]}, ${e[1]}, ${e[2]})
fn main(@builtin(local_invocation_id) localId : vec3<u32>,
        @builtin(global_invocation_id) globalId : vec3<u32>,
        @builtin(workgroup_id) workgroupId : vec3<u32>) {
  let localRow = i32(localId.y);
  let tileRow = localRow * rowPerThread;
  let tileCol = i32(localId.x);

  let globalRow =i32(globalId.y) * rowPerThread;
  let globalCol = i32(globalId.x);
  let batch = ${a?"0":"i32(globalId.z)"};
  ${t?`let batchIndices = ${t.offsetToIndices("u32(batch)")};`:""}
  let globalRowStart = i32(workgroupId.y) * ${u};

  let num_tiles = ${a?`${Math.ceil(s/i)}`:"(uniforms.dim_inner - 1) / tileInner + 1"};
  var kStart = ${a?`i32(globalId.z) * ${s}`:"0"};

  var acc: array<vec4<${n}>, rowPerThread>;

  // Loop over shared dimension.
  let tileRowB = localRow * ${g};
  for (var t = 0; t < num_tiles; t = t + 1) {
      // Load one tile of A into local memory.
      for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
          let inputRow = tileRow + innerRow;
          let inputCol = tileCol;
          ${_E(o,t)}
      }

      // Load one tile of B into local memory.
      for (var innerRow = 0; innerRow < ${g}; innerRow = innerRow + 1) {
          let inputRow = tileRowB + innerRow;
          let inputCol = tileCol;
          mm_Bsub[inputRow][inputCol] = mm_readB(batch, kStart + inputRow, globalCol${t?", batchIndices":""});
      }
      kStart = kStart + tileInner;
      workgroupBarrier();

      // Compute acc values for a single thread.
      for (var k = 0; k < tileInner / innerElementSize; k = k + 1) {
          let BCached0 = mm_Bsub[k * innerElementSize][tileCol];
          let BCached1 = mm_Bsub[k * innerElementSize + 1][tileCol];
          let BCached2 = mm_Bsub[k * innerElementSize + 2][tileCol];
          ${h===3?"":"let BCached3 = mm_Bsub[k * innerElementSize + 3][tileCol];"}

          ${wE(o,h)}
      }

      workgroupBarrier();
  }

  for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
      mm_write(batch, globalRow + innerRow, globalCol, acc[innerRow]);
  }
}`},bw=(r,e)=>r?`
            mm_Asub[inputRow][inputCol] = mm_readA(batch,
              kStart + inputRow,
              globalRowStart + inputCol${e?", batchIndices":""});
            `:`
            mm_Asub[inputRow][inputCol] = mm_readA(batch,
              globalRowStart + inputRow,
              kStart + inputCol${e?", batchIndices":""});
            `,vE=r=>r?"let ACached = mm_Asub[k][tileRow + innerRow];":"let ACached = mm_Asub[tileRow + innerRow][k];",kc=(r,e,n="f32",t,o=!1,i=32,a=!1,s=32,u=!1)=>{let l=r[1]*e[1],d=r[0]*e[0],p=o?l:i,h=o?i:l;if(!(h%e[1]===0&&p%e[0]===0&&i%e[1]===0))throw new Error(`tileAHight ${h} must be divisible by workgroupSize[1]${e[1]}, tileAWidth ${p} must be divisible by workgroupSize[0]${e[0]}, tileInner ${i} must be divisible by workgroupSize[1]${e[1]}`);let g=h/e[1],b=p/e[0],_=i/e[1],S=u?`
    let localRow = i32(localId.y);
    let localCol = i32(localId.x);
    let globalRowStart = i32(workgroupId.y) * ${l};
    let globalColStart = i32(workgroupId.x) * ${d};

    // Loop over shared dimension.
    for (var t = 0; t < num_tiles; t = t + 1) {
      // Load one tile of A into local memory.
      for (var inputRow = localRow; inputRow < ${h}; inputRow = inputRow + ${e[1]}) {
        for (var inputCol = localCol; inputCol < ${p}; inputCol = inputCol + ${e[0]}) {
          ${bw(o,t)}
        }
      }
      // Load one tile of B into local memory.
      for (var inputRow = localRow; inputRow < ${i}; inputRow = inputRow + ${e[1]}) {
            for (var inputCol = localCol; inputCol < ${d}; inputCol = inputCol + ${e[0]}) {
          mm_Bsub[inputRow][inputCol] = mm_readB(batch,
            kStart + inputRow,
            globalColStart + inputCol${t?", batchIndices":""});
        }
      }
      kStart = kStart + tileInner;
      workgroupBarrier();

      // Compute acc values for a single thread.
      var BCached : array<${n}, colPerThread>;
      for (var k = 0; k < tileInner; k = k + 1) {
        for (var inner = 0; inner < colPerThread; inner = inner + 1) {
          BCached[inner] = mm_Bsub[k][localCol + inner * ${e[0]}];
        }
        for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
          let ACached = ${o?`mm_Asub[k][localRow + innerRow * ${e[1]}];`:`mm_Asub[localRow + innerRow * ${e[1]}][k];`}
          for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
            acc[innerRow][innerCol] = acc[innerRow][innerCol] +
                ACached * BCached[innerCol];
          }
        }
      }
      workgroupBarrier();
    }
    for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
      let gRow = globalRowStart + localRow + innerRow * ${e[1]};
      for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
        let gCol = globalColStart + localCol + innerCol * ${e[0]};
        mm_write(batch, gRow, gCol, acc[innerRow][innerCol]);
      }
    }
    `:`
let tileRow = i32(localId.y) * rowPerThread;
let tileCol = i32(localId.x) * colPerThread;

let globalRow = i32(globalId.y) * rowPerThread;
let globalCol = i32(globalId.x) * colPerThread;
let globalRowStart = i32(workgroupId.y) * ${l};

let tileRowA = i32(localId.y) * ${g};
let tileColA = i32(localId.x) * ${b};
let tileRowB = i32(localId.y) * ${_};
// Loop over shared dimension.
for (var t = 0; t < num_tiles; t = t + 1) {
  // Load one tile of A into local memory.
  for (var innerRow = 0; innerRow < ${g}; innerRow = innerRow + 1) {
    for (var innerCol = 0; innerCol < ${b}; innerCol = innerCol + 1) {
      let inputRow = tileRowA + innerRow;
      let inputCol = tileColA + innerCol;
      ${bw(o,t)}
    }
  }

  // Load one tile of B into local memory.
  for (var innerRow = 0; innerRow < ${_}; innerRow = innerRow + 1) {
    for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
      let inputRow = tileRowB + innerRow;
      let inputCol = tileCol + innerCol;
      mm_Bsub[inputRow][inputCol] = mm_readB(batch,
        kStart + inputRow,
        globalCol + innerCol${t?", batchIndices":""});
    }
  }
  kStart = kStart + tileInner;
  workgroupBarrier();

  // Compute acc values for a single thread.
  var BCached : array<${n}, colPerThread>;
  for (var k = 0; k < tileInner; k = k + 1) {
    for (var inner = 0; inner < colPerThread; inner = inner + 1) {
      BCached[inner] = mm_Bsub[k][tileCol + inner];
    }

    for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
      ${vE(o)}
      for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
        acc[innerRow][innerCol] = acc[innerRow][innerCol] + ACached * BCached[innerCol];
      }
    }
  }

  workgroupBarrier();
}

for (var innerRow = 0; innerRow < rowPerThread; innerRow = innerRow + 1) {
  for (var innerCol = 0; innerCol < colPerThread; innerCol = innerCol + 1) {
    mm_write(batch, globalRow + innerRow, globalCol + innerCol,
        acc[innerRow][innerCol]);
  }
}
`;return`
  var<workgroup> mm_Asub : array<array<${n}, ${p}>, ${h}>;
  var<workgroup> mm_Bsub : array<array<${n}, ${d}>, ${i}>;
  const rowPerThread = ${r[1]};
  const colPerThread = ${r[0]};
  const tileInner = ${i};

@compute @workgroup_size(${e[0]}, ${e[1]}, ${e[2]})
fn main(@builtin(local_invocation_id) localId : vec3<u32>,
        @builtin(global_invocation_id) globalId : vec3<u32>,
        @builtin(workgroup_id) workgroupId : vec3<u32>) {
    let batch = ${a?"0":"i32(globalId.z)"};
    ${t?`let batchIndices = ${t.offsetToIndices("u32(batch)")};`:""}
    let num_tiles = ${a?`${Math.ceil(s/i)}`:"(uniforms.dim_inner - 1) / tileInner + 1"};
    var kStart = ${a?`i32(globalId.z) * ${s}`:"0"};

    var acc : array<array<${n}, colPerThread>, rowPerThread>;
    ${S}
  }
`},xE=(r,e,n,t,o=!1)=>{let[i,a,s,u]=t,l=Ue(t[0].type.tensor);return`
    fn mm_readA(batch: i32, row: i32, colIn: i32, batchIndices: ${i.type.indices}) -> ${at(r,l)} {
      var value = ${at(r,l)}(0.0);
      let col = colIn * ${r};
      if(row < uniforms.dim_a_outer && col < uniforms.dim_inner)
      {
        var aIndices: ${a.type.indices};
        ${qo("aIndices",a,a.rank-2,i.rank,"batchIndices")}
        ${a.indicesSet("aIndices",a.rank-2,"u32(row)")}
        ${a.indicesSet("aIndices",a.rank-1,"u32(colIn)")}
        value = ${a.getByIndices("aIndices")};
      }
      return value;
    }

    fn mm_readB(batch: i32, row: i32, colIn: i32, batchIndices: ${i.type.indices}) -> ${at(r,l)} {
      var value = ${at(r,l)}(0.0);
      let col = colIn * ${r};
      if(row < uniforms.dim_inner && col < uniforms.dim_b_outer)
      {
        var bIndices: ${s.type.indices};
        ${qo("bIndices",s,s.rank-2,i.rank,"batchIndices")}
        ${s.indicesSet("bIndices",s.rank-2,"u32(row)")}
        ${s.indicesSet("bIndices",s.rank-1,"u32(colIn)")}
        value = ${s.getByIndices("bIndices")};
      }
      return value;
    }

    fn mm_write(batch: i32, row: i32, colIn: i32, valueIn: ${at(r,l)}) {
      let col = colIn * ${r};
      if (row < uniforms.dim_a_outer && col < uniforms.dim_b_outer) {
        var value = valueIn;
        let coords = vec3<i32>(batch, row, colIn);
        ${e?`value = value + ${o?"bias[colIn]":`${at(r,l)}(bias[row])`};`:""}
        ${n}
        ${u.setByIndices("vec3<u32>(coords)","value")}
      }
    }
    `},jo=(r,e,n,t,o=!1,i)=>{let a=r[0].dims,s=r[1].dims,u=a.slice(0,-2),l=s.slice(0,-2),d=t?t.slice(0,-2):n.slice(0,-2),p=k.size(d),h=a[a.length-2],g=a[a.length-1],b=s[s.length-1],_=g%4===0&&b%4===0,S=h<=8?[4,1,1]:[4,4,1],v=[8,8,1],x=[Math.ceil(b/v[0]/S[0]),Math.ceil(h/v[1]/S[1]),Math.ceil(p/v[2]/S[2])],$=_?4:1,O=[...u,h,g/$],E=O.length,D=[...l,g,b/$],B=D.length,T=[p,h,b/$],F=[{type:6,data:h},{type:6,data:b},{type:6,data:g}];Yt(e,F),F.push(...K(d,O,D));let W=["rank","rank"],z=r.length>2;z&&(F.push(...K(r[2].dims)),W.push("rank")),F.push(...K(T));let te=V=>{let w=d.length,R=Ga("batchDims",r[0].dataType,w,1),j=Ue(r[0].dataType),J=M("a",r[0].dataType,E,$),Z=M("b",r[1].dataType,B,$),oe=H("result",r[0].dataType,T.length,$),se=[J,Z];if(z){let q=o?$:1;se.push(M("bias",r[2].dataType,r[2].dims.length,q))}let pe=[{name:"dim_a_outer",type:"i32"},{name:"dim_b_outer",type:"i32"},{name:"dim_inner",type:"i32"}];Qt(e,pe);let De=Ue(oe.type.tensor),fe=Jt(e,oe.type.value,De),U=xE($,z,fe,[R,J,Z,oe],o);return`
  ${V.registerUniforms(pe).registerInternalVariables(R).declareVariables(...se,oe)}
  ${U}
  ${_?Dc(S,v,j,R):kc(S,v,j,R)}
                   `};return{name:"MatMul",shaderCache:{hint:`${S};${e.activation};${_};${o}`,inputDependencies:W},getRunData:()=>({outputs:[{dims:i?i(n):n,dataType:r[0].dataType}],dispatchGroup:{x:x[0],y:x[1],z:x[2]},programUniforms:F}),getShaderSource:te}}});var TE,yw,_w=L(()=>{"use strict";ce();Un();be();_r();Ka();gw();Ja();TE=(r,e,n,t,o=!1,i,a=4,s=4,u=4,l="f32")=>{let d=W=>{switch(W){case 1:return"resData = x[xIndex];";case 3:return`resData = vec3<${l}>(x[xIndex], x[xIndex + 1], x[xIndex + 2]);`;case 4:return"resData = x[xIndex / 4];";default:throw new Error(`innerElementSize ${W} is not supported.`)}},p=W=>{switch(W){case 1:return"return w[row * i32(uniforms.w_shape[3]) + colIn];";case 4:return"return w[row * i32(uniforms.w_shape[3]) / 4 + colIn];";default:throw new Error(`innerElementSize ${W} is not supported.`)}},h=r?`
    let coord = vec4<i32>(batch, xRow, xCol, xCh);
    `:`
    let coord = vec4<i32>(batch, xCh, xRow, xCol);
    `,g=r?`
    let coords = vec4<i32>(
      batch,
      row / outWidth,
      row % outWidth,
      col);
    `:`
    let coords = vec4<i32>(
      batch,
      row,
      col / outWidth,
      col % outWidth);
    `,b=r?"i32(uniforms.x_shape[1])":"i32(uniforms.x_shape[2])",_=r?"i32(uniforms.x_shape[2])":"i32(uniforms.x_shape[3])",S=r?"row":"col",v=r?"col":"row",x=`
    let inChannels = i32(uniforms.w_shape[2]);
    let outWidth = ${r?"i32(uniforms.result_shape[2])":"i32(uniforms.result_shape[3])"};
    let outRow = ${S} / outWidth;
    let outCol = ${S} % outWidth;

    let WRow = ${v} / (i32(uniforms.w_shape[1]) * inChannels);
    let WCol = ${v} / inChannels % i32(uniforms.w_shape[1]);
    let xRow = outRow * uniforms.stride[0] + uniforms.dilation[0] * WRow - uniforms.pad[0];
    let xCol = outCol * uniforms.stride[1] + uniforms.dilation[1] * WCol - uniforms.pad[1];
    let xCh = ${v} % inChannels;
    var resData = ${at(a,l)}(0.0);
    // The bounds checking is always needed since we use it to pad zero for
    // the 'same' padding type.
    if (xRow >= 0 && xRow < ${b} && xCol >= 0 && xCol < ${_}) {
      ${h}
      let xIndex = getIndexFromCoords4D(coord, vec4<i32>(uniforms.x_shape));
      ${d(a)}
    }
    return resData;`,$=r?e&&t?`
    let col = colIn * ${a};
    ${x}`:`
    let col = colIn * ${a};
    if (row < uniforms.dim_a_outer && col < uniforms.dim_inner) {
      ${x}
    }
    return ${at(a,l)}(0.0);`:t&&n?`
    let col = colIn * ${a};
    ${x}`:`
    let col = colIn * ${a};
    if (row < uniforms.dim_inner && col < uniforms.dim_b_outer) {
      ${x}
    }
    return ${at(a,l)}(0.0);`,O=r?t&&n?p(s):`
    let col = colIn * ${s};
    if (row < uniforms.dim_inner && col < uniforms.dim_b_outer) {
      ${p(s)}
    }
    return ${at(s,l)}(0.0);`:`
    let col = colIn * ${s};
    if (row < uniforms.dim_inner && col < uniforms.dim_a_outer) {
      ${p(s)}
    }
    return ${at(s,l)}(0.0);`,E=at(u,l),D=r?at(a,l):at(s,l),B=r?at(s,l):at(a,l),T=Jt(i,E,l);return`
    fn mm_readA(batch: i32, row : i32, colIn : i32) -> ${D} {
      ${r?$:O}
    }

    fn mm_readB(batch: i32, row : i32, colIn : i32) -> ${B} {
      ${r?O:$}
    }

    fn mm_write(batch: i32, row : i32, colIn : i32, valueIn : ${E}) {
      let col = colIn * ${u};
      if (row < uniforms.dim_a_outer && col < uniforms.dim_b_outer)
      {
      var value = valueIn;
      let outWidth = ${r?"i32(uniforms.result_shape[2])":"i32(uniforms.result_shape[3])"};
      ${g}
      ${hw(o)}
      ${T}
      setOutputAtCoords(coords[0], coords[1], coords[2], coords[3], value);
      }
    }`},yw=(r,e,n,t,o,i,a,s,u)=>{let l=e.format==="NHWC",d=l?r[0].dims[3]:r[0].dims[1],p=n[0],h=l?n[2]:n[3],g=l?n[1]:n[2],b=l?n[3]:n[1],_=l&&(d%4===0||d%3===0)&&b%4===0,S=l?b:h*g,v=l?h*g:b,x=[8,8,1],$=t<=8?[4,1,1]:[4,4,1],O=[Math.ceil(S/x[0]/$[0]),Math.ceil(v/x[1]/$[1]),Math.ceil(p/x[2]/$[2])];_e("verbose",()=>`[conv2d_mm_webgpu] dispatch = ${O}`);let E=_?l&&d%4!==0?3:4:1,D=x[1]*$[1],B=x[0]*$[0],T=Math.max(x[0]*E,x[1]),F=t%D===0,W=o%B===0,z=i%T===0,te=_?[E,4,4]:[1,1,1],V=[{type:6,data:t},{type:6,data:o},{type:6,data:i},{type:6,data:[e.pads[0],e.pads[1]]},{type:6,data:e.strides},{type:6,data:e.dilations}];Yt(e,V),V.push(...K(r[0].dims,r[1].dims));let w=["rank","rank"];a&&(V.push(...K(r[2].dims)),w.push("rank")),V.push(...K(n));let R=j=>{let J=[{name:"dim_a_outer",type:"i32"},{name:"dim_b_outer",type:"i32"},{name:"dim_inner",type:"i32"},{name:"pad",type:"i32",length:2},{name:"stride",type:"i32",length:2},{name:"dilation",type:"i32",length:2}];Qt(e,J);let Z=_?4:1,oe=Ue(r[0].dataType),se=`
      fn setOutputAtIndex(flatIndex : i32, value : ${_?`vec4<${oe}>`:oe}) {
        result[flatIndex] = ${_?`vec4<${oe}>`:oe}(value);
      }
      fn setOutputAtCoords(d0 : i32, d1 : i32, d2 : i32, d3 : i32, value : ${_?`vec4<${oe}>`:oe}) {
        let flatIndex = getOutputIndexFromCoords(vec4<i32>(d0, d1, d2, d3));
        setOutputAtIndex(flatIndex ${_?"/ 4":""}, value);
      }`,pe=M("x",r[0].dataType,r[0].dims.length,E===3?1:E),De=M("w",r[1].dataType,r[1].dims.length,Z),fe=[pe,De],U=H("result",r[0].dataType,n.length,Z);if(a){let q=M("bias",r[2].dataType,r[2].dims.length,Z);fe.push(q),se+=`
        fn getBiasByOutputCoords(coords : vec4<i32>) -> ${_?`vec4<${oe}>`:oe} {
          return bias[coords.${l?"w":"y"}${_?"/ 4":""}];
        }`}return`
        ${mw("uniforms.result_strides")}
        //struct Uniforms { xShape : vec4<i32>, wShape : vec4<i32>, outShape : vec4<i32>,
        //  outShapeStrides: vec3<i32>, filterDims : vec2<i32>, pad : vec2<i32>, stride : vec2<i32>,
        //  dilation : vec2<i32>, dimAOuter : i32, dimBOuter : i32, dimInner : i32 };
        ${j.registerUniforms(J).declareVariables(...fe,U)}
        ${se}
        ${TE(l,F,W,z,a,e,te[0],te[1],te[2],oe)}
        ${_?Dc($,x,oe,void 0,!l,T):kc($,x,oe,void 0,!l,T,!1,void 0,s)}`};return{name:"Conv2DMatMul",shaderCache:{hint:`${e.cacheKey};${E};${_};${F};${W};${z};${D};${B};${T}`,inputDependencies:w},getRunData:()=>({outputs:[{dims:u?u(n):n,dataType:r[0].dataType}],dispatchGroup:{x:O[0],y:O[1],z:O[2]},programUniforms:V}),getShaderSource:R}}});var IE,ww,Ya,SE,vw,$E,xw,Tw,Iw=L(()=>{"use strict";ce();Un();me();be();_r();Ka();IE=r=>{let e=1;for(let n=0;n<r.length;n++)e*=r[n];return e},ww=r=>typeof r=="number"?[r,r,r]:r,Ya=(r,e)=>e<=1?r:r+(r-1)*(e-1),SE=(r,e,n,t=1)=>{let o=Ya(e,t);return Math.floor((r[0]*(n-1)-n+o)/2)},vw=(r,e,n,t,o)=>{o==null&&(o=SE(r,e[0],t[0]));let i=[0,0,0,n];for(let a=0;a<3;a++)r[a]+2*o>=e[a]&&(i[a]=Math.trunc((r[a]-e[a]+2*o)/t[a]+1));return i},$E=(r,e,n,t,o,i,a,s,u,l)=>{let d,p,h,g;if(r==="VALID"&&(r=0),typeof r=="number"){d={top:r,bottom:r,left:r,right:r,front:r,back:r};let b=vw([e,n,t,1],[s,u,l],1,[o,i,a],r);p=b[0],h=b[1],g=b[2]}else if(Array.isArray(r)){if(!r.every((_,S,v)=>_===v[0]))throw Error(`Unsupported padding parameter: ${r}`);d={top:r[0],bottom:r[1],left:r[2],right:r[3],front:r[4],back:r[5]};let b=vw([e,n,t,1],[s,u,l],1,[o,i,a],r[0]);p=b[0],h=b[1],g=b[2]}else if(r==="SAME_UPPER"){p=Math.ceil(e/o),h=Math.ceil(n/i),g=Math.ceil(t/a);let b=(p-1)*o+s-e,_=(h-1)*i+u-n,S=(g-1)*a+l-t,v=Math.floor(b/2),x=b-v,$=Math.floor(_/2),O=_-$,E=Math.floor(S/2),D=S-E;d={top:$,bottom:O,left:E,right:D,front:v,back:x}}else throw Error(`Unknown padding parameter: ${r}`);return{padInfo:d,outDepth:p,outHeight:h,outWidth:g}},xw=(r,e,n,t,o,i=!1,a="channelsLast")=>{let s,u,l,d,p;if(a==="channelsLast")[s,u,l,d,p]=r;else if(a==="channelsFirst")[s,p,u,l,d]=r;else throw new Error(`Unknown dataFormat ${a}`);let[h,,g,b,_]=e,[S,v,x]=ww(n),[$,O,E]=ww(t),D=Ya(g,$),B=Ya(b,O),T=Ya(_,E),{padInfo:F,outDepth:W,outHeight:z,outWidth:te}=$E(o,u,l,d,S,v,x,D,B,T),V=i?h*p:h,w=[0,0,0,0,0];return a==="channelsFirst"?w=[s,V,W,z,te]:a==="channelsLast"&&(w=[s,W,z,te,V]),{batchSize:s,dataFormat:a,inDepth:u,inHeight:l,inWidth:d,inChannels:p,outDepth:W,outHeight:z,outWidth:te,outChannels:V,padInfo:F,strideDepth:S,strideHeight:v,strideWidth:x,filterDepth:g,filterHeight:b,filterWidth:_,effectiveFilterDepth:D,effectiveFilterHeight:B,effectiveFilterWidth:T,dilationDepth:$,dilationHeight:O,dilationWidth:E,inShape:r,outShape:w,filterShape:e}},Tw=(r,e,n,t,o,i)=>{let a=i==="channelsLast",s=a?r[0].dims[3]:r[0].dims[1],u=!1,l=[64,1,1],d={x:n.map((x,$)=>$)},p=[Math.ceil(IE(d.x.map(x=>n[x]))/l[0]),1,1];_e("verbose",()=>`[conv3d_naive_webgpu] dispatch = ${p}`);let h=u?a&&s%4!==0?3:4:1,g=k.size(n),b=[{type:12,data:g},{type:12,data:t},{type:12,data:o},{type:12,data:e.strides},{type:12,data:e.dilations}];Yt(e,b),b.push(...K(r[0].dims,r[1].dims));let _=["rank","rank"],S=r.length===3;S&&(b.push(...K(r[2].dims)),_.push("rank")),b.push(...K(n));let v=x=>{let $=[{name:"output_size",type:"u32"},{name:"filter_dims",type:"u32",length:t.length},{name:"pads",type:"u32",length:o.length},{name:"strides",type:"u32",length:e.strides.length},{name:"dilations",type:"u32",length:e.dilations.length}];Qt(e,$);let O=u?4:1,E=Ue(r[0].dataType),D=M("x",r[0].dataType,r[0].dims.length,h===3?1:h),B=M("W",r[1].dataType,r[1].dims.length,O),T=[D,B],F=H("result",r[0].dataType,n.length,O),W="";if(S){let V=M("bias",r[2].dataType,r[2].dims.length,O);T.push(V),W+=`
        fn getBiasByOutputCoords(coords : array<u32, 5>) -> ${u?`vec4<${E}>`:E} {
          return bias[${a?re("coords",4,5):re("coords",1,5)}${u?"/ 4":""}];
        }`}let z=at(h,E),te=Jt(e,z,E);return`
            ${W}
            fn getX(d0 : u32, d1 : u32, d2 : u32, d3 : u32, d4 : u32) -> f32 {
              let aIndices = array<u32, 5>(d0, d1, d2, d3, d4);
              return ${D.getByIndices("aIndices")};
            }
            fn getW(d0 : u32, d1 : u32, d2 : u32, d3 : u32, d4 : u32) -> f32 {
              let aIndices = array<u32, 5>(d0, d1, d2, d3, d4);
              return ${B.getByIndices("aIndices")};
            }
          ${x.registerUniforms($).declareVariables(...T,F)}
          ${x.mainStart()}
          ${x.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
              let coords = ${F.offsetToIndices("global_idx")};
              let batch = ${re("coords",0,D.rank)};
              let d2 = ${a?re("coords",D.rank-1,D.rank):re("coords",1,D.rank)};
              let xFRCCorner = vec3<u32>(${a?re("coords",1,D.rank):re("coords",2,D.rank)},
              ${a?re("coords",2,D.rank):re("coords",3,D.rank)},
              ${a?re("coords",3,D.rank):re("coords",4,D.rank)}) * uniforms.strides - uniforms.pads;
              let xFCorner = xFRCCorner.x;
              let xRCorner = xFRCCorner.y;
              let xCCorner = xFRCCorner.z;
              let xShapeY = ${a?re("uniforms.x_shape",1,D.rank):re("uniforms.x_shape",2,D.rank)};
              let xShapeZ = ${a?re("uniforms.x_shape",2,D.rank):re("uniforms.x_shape",3,D.rank)};
              let xShapeW = ${a?re("uniforms.x_shape",3,D.rank):re("uniforms.x_shape",4,D.rank)};
              let xShapeU = ${a?re("uniforms.x_shape",4,D.rank):re("uniforms.x_shape",1,D.rank)};
              let inputDepthNearestVec4 = (xShapeU / 4) * 4;
              let inputDepthVec4Remainder = xShapeU % 4;

              var value = 0.0;
              for (var wF = 0u; wF < uniforms.filter_dims[0]; wF++) {
                let xF = xFCorner + wF * uniforms.dilations[0];
                if (xF < 0 || xF >= xShapeY) {
                  continue;
                }

                for (var wR = 0u; wR < uniforms.filter_dims[1]; wR++) {
                  let xR = xRCorner + wR * uniforms.dilations[1];
                  if (xR < 0 || xR >= xShapeZ) {
                    continue;
                  }

                  for (var wC = 0u; wC < uniforms.filter_dims[2]; wC++) {
                    let xC = xCCorner + wC * uniforms.dilations[2];
                    if (xC < 0 || xC >= xShapeW) {
                      continue;
                    }

                    for (var d1 = 0u; d1 < inputDepthNearestVec4; d1 += 4) {
                      ${a?`let xValues = vec4<f32>(
                               getX(batch, xF, xR, xC, d1),
                               getX(batch, xF, xR, xC, d1 + 1),
                               getX(batch, xF, xR, xC, d1 + 2),
                               getX(batch, xF, xR, xC, d1 + 3));
                            `:`let xValues = vec4<f32>(
                               getX(batch, d1, xF, xR, xC),
                               getX(batch, d1 + 1, xF, xR, xC),
                               getX(batch, d1 + 2, xF, xR, xC),
                               getX(batch, d1 + 3, xF, xR, xC));
                            `}
                            let wValues = vec4<f32>(
                              getW(d2, d1, wF, wR, wC),
                              getW(d2, d1 + 1, wF, wR, wC),
                              getW(d2, d1 + 2, wF, wR, wC),
                              getW(d2, d1 + 3, wF, wR, wC));
                      value += dot(xValues, wValues);
                    }
                    if (inputDepthVec4Remainder == 1) {
                        ${a?`value += getX(batch, xF, xR, xC, inputDepthNearestVec4)
                          * getW(d2, inputDepthNearestVec4, wF, wR, wC);`:`value += getX(batch, inputDepthNearestVec4, xF, xR, xC)
                          * getW(d2, inputDepthNearestVec4, wF, wR, wC);`}
                    } else if (inputDepthVec4Remainder == 2) {
                      ${a?`let xValues = vec2<f32>(
                        getX(batch, xF, xR, xC, inputDepthNearestVec4),
                        getX(batch, xF, xR, xC, inputDepthNearestVec4 + 1));
                      `:`let xValues = vec2<f32>(
                        getX(batch, inputDepthNearestVec4, xF, xR, xC),
                        getX(batch, inputDepthNearestVec4 + 1, xF, xR, xC));
                    `}
                    let wValues = vec2<f32>(
                      getW(d2, inputDepthNearestVec4, wF, wR, wC),
                      getW(d2, inputDepthNearestVec4 + 1, wF, wR, wC));
                      value += dot(xValues, wValues);
                    } else if (inputDepthVec4Remainder == 3) {
                      ${a?`let xValues = vec3<f32>(
                        getX(batch, xF, xR, xC, inputDepthNearestVec4),
                        getX(batch, xF, xR, xC, inputDepthNearestVec4 + 1),
                        getX(batch, xF, xR, xC, inputDepthNearestVec4 + 2));
                      `:`let xValues = vec3<f32>(
                        getX(batch, inputDepthNearestVec4, xF, xR, xC),
                        getX(batch, inputDepthNearestVec4 + 1, xF, xR, xC),
                        getX(batch, inputDepthNearestVec4 + 2, xF, xR, xC));
                    `}
                    let wValues = vec3<f32>(
                      getW(d2, inputDepthNearestVec4, wF, wR, wC),
                      getW(d2, inputDepthNearestVec4 + 1, wF, wR, wC),
                      getW(d2, inputDepthNearestVec4 + 2, wF, wR, wC));
                      value += dot(xValues, wValues);
                    }
                  }
                }
              }
              ${S?"value = value + getBiasByOutputCoords(coords)":""};
              ${te}
              result[global_idx] = f32(value);
          }`};return{name:"Conv3DNaive",shaderCache:{hint:`${e.cacheKey};${a};${h};${S}`,inputDependencies:_},getRunData:()=>({outputs:[{dims:n,dataType:r[0].dataType}],dispatchGroup:{x:p[0],y:p[1],z:p[2]},programUniforms:b}),getShaderSource:v}}});var Sw,$w,Aw=L(()=>{"use strict";ce();me();be();_r();Sw=(r,e,n,t)=>{let o=r.length>2,i=o?"value += b[output_channel];":"",a=r[0].dims,s=r[1].dims,u=e.format==="NHWC",l=u?n[3]:n[1],d=l/e.group,p=u&&d>=4?Ce(l):1,h=k.size(n)/p,g=[{type:12,data:h},{type:12,data:e.dilations},{type:12,data:[e.strides[0],e.strides[1]]},{type:12,data:[e.pads[0],e.pads[1]]},{type:12,data:d}];Yt(e,g),g.push(...K(a,[s[0],s[1],s[2],s[3]/p]));let b=o?["rank","rank","rank"]:["rank","rank"];g.push(...K([n[0],n[1],n[2],n[3]/p]));let _=S=>{let v=H("output",r[0].dataType,n.length,p),x=Ue(v.type.tensor),$=Jt(e,v.type.value,x),O=M("x",r[0].dataType,a.length),E=M("w",r[1].dataType,s.length,p),D=[O,E];o&&D.push(M("b",r[2].dataType,r[2].dims,p));let B=[{name:"output_size",type:"u32"},{name:"dilations",type:"u32",length:e.dilations.length},{name:"strides",type:"u32",length:2},{name:"pads",type:"u32",length:2},{name:"output_channels_per_group",type:"u32"}];Qt(e,B);let T=u?`
      for (var wHeight: u32 = 0u; wHeight < uniforms.w_shape[0]; wHeight++) {
        let xHeight = xRCCorner.x + wHeight * uniforms.dilations[0];

        if (xHeight < 0u || xHeight >= uniforms.x_shape[1]) {
          continue;
        }

        for (var wWidth: u32 = 0u; wWidth < uniforms.w_shape[1]; wWidth++) {
          let xWidth = xRCCorner.y + wWidth * uniforms.dilations[1];
          if (xWidth < 0u || xWidth >= uniforms.x_shape[2]) {
            continue;
          }

          for (var wInChannel: u32 = 0u; wInChannel < uniforms.w_shape[2]; wInChannel++) {
            let input_channel = in_channel_offset + wInChannel;
            let xVal = ${O.get("batch","xHeight","xWidth","input_channel")};
            let wVal = ${E.get("wHeight","wWidth","wInChannel","output_channel")};
            value += xVal * wVal;
          }
        }
      }
      `:`
      for (var wInChannel: u32 = 0u; wInChannel < uniforms.w_shape[1]; wInChannel++) {
        let input_channel = in_channel_offset + wInChannel;
        for (var wHeight: u32 = 0u; wHeight < uniforms.w_shape[2]; wHeight++) {
          let xHeight = xRCCorner.x + wHeight * uniforms.dilations[0];

          if (xHeight < 0u || xHeight >= uniforms.x_shape[2]) {
            continue;
          }

          for (var wWidth: u32 = 0u; wWidth < uniforms.w_shape[3]; wWidth++) {
            let xWidth = xRCCorner.y + wWidth * uniforms.dilations[1];
            if (xWidth < 0u || xWidth >= uniforms.x_shape[3]) {
              continue;
            }

            let xVal = ${O.get("batch","input_channel","xHeight","xWidth")};
            let wVal = ${E.get("output_channel","wInChannel","wHeight","wWidth")};
            value += xVal * wVal;
          }
        }
      }
      `;return`
  ${S.registerUniforms(B).declareVariables(...D,v)}

  ${S.mainStart()}
    ${S.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let outputIndices = ${v.offsetToIndices("global_idx")};
    let batch: u32 = outputIndices[0];
    let output_channel: u32 = outputIndices[${u?3:1}];
    let xRCCorner: vec2<u32> = vec2<u32>(outputIndices[${u?1:2}], outputIndices[${u?2:3}]) * uniforms.strides - uniforms.pads;
    let group_id: u32 = output_channel * ${p} / uniforms.output_channels_per_group;
    var in_channel_offset = group_id * uniforms.w_shape[${u?2:1}];

    var value: ${v.type.value} = ${v.type.value}(0);
    ${T}
    ${i}
    ${$}
    ${v.setByOffset("global_idx","value")}
  }`};return{name:"GroupedConv",shaderCache:{hint:`${e.cacheKey}_${p}`,inputDependencies:b},getRunData:()=>({outputs:[{dims:t?t(n):n,dataType:r[0].dataType}],dispatchGroup:{x:Math.ceil(h/64)},programUniforms:g}),getShaderSource:_}},$w=(r,e,n,t)=>{let o=r.length>2,i=Ce(n[3]),a=Ce(n[2]),s=k.size(n)/i/a,u=[r[0].dims[0],r[0].dims[1],r[0].dims[2],r[0].dims[3]/i],l=[r[1].dims[0],r[1].dims[1],r[1].dims[2],r[1].dims[3]/i],d=[n[0],n[1],n[2],n[3]/i],p=[{type:12,data:s},{type:6,data:[e.strides[0],e.strides[1]]},{type:6,data:[e.pads[0],e.pads[1]]}];Yt(e,p),p.push(...K(u,l,d));let h=(a-1)*e.strides[1]+l[1],g=b=>{let _=H("output",r[0].dataType,d.length,i),S=Ue(_.type.tensor),v=Jt(e,_.type.value,S),x=M("x",r[0].dataType,u.length,i),$=M("w",r[1].dataType,l.length,i),O=[x,$];o&&O.push(M("b",r[2].dataType,r[2].dims,i));let E=o?"value += b[output_channel];":"",D=[{name:"output_size",type:"u32"},{name:"strides",type:"i32",length:2},{name:"pads",type:"i32",length:2}];return Qt(e,D),`
  ${b.registerUniforms(D).declareVariables(...O,_)}
  ${b.mainStart()}
    ${b.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let width0 = uniforms.output_shape[3];
    let output_channel = global_idx % width0;
    var index1 = global_idx / width0;
    let width1 = uniforms.output_shape[2] / ${a}u;
    let col = (index1 % width1) * ${a}u;
    index1 = index1 / width1;
    let row = index1 % uniforms.output_shape[1];
    let batch = index1 / uniforms.output_shape[1];

    let x_corner = vec2<i32>(i32(row), i32(col)) * uniforms.strides - uniforms.pads;

    var x_vals: array<${x.type.value}, ${h}>;
    var values: array<${_.type.value}, ${a}>;
    let input_channel = output_channel;
    // Use constant instead of uniform can give better performance for w's height/width.
    for (var w_height: u32 = 0u; w_height < ${l[0]}; w_height++) {
      let x_height = x_corner.x + i32(w_height);
      if (x_height >= 0 && u32(x_height) < uniforms.x_shape[1]) {
        for (var i = 0; i < ${h}; i++) {
          let x_width = x_corner.y + i;
          if (x_width >= 0 && u32(x_width) < uniforms.x_shape[2]) {
            x_vals[i] = ${x.get("batch","u32(x_height)","u32(x_width)","input_channel")};
          } else {
            x_vals[i] = ${x.type.value}(0);
          }
        }
        for (var w_width: u32 = 0u; w_width < ${l[1]}; w_width++) {
          let w_val = ${$.get("w_height","w_width","0","output_channel")};
          for (var i = 0u; i < ${a}u; i++) {
            values[i] = fma(x_vals[i * u32(uniforms.strides[1]) + w_width], w_val, values[i]);
          }
        }
      }
    }

    for (var i = 0u; i < ${a}u; i++) {
      var value = values[i];
      ${E}
      ${v}
      ${_.set("batch","row","col + i","output_channel","value")};
    }
  }`};return{name:"GroupedConv-Vectorize",shaderCache:{hint:`${e.cacheKey};${i};${a};${h};${l[0]};${l[1]}`,inputDependencies:o?["rank","rank","type"]:["rank","rank"]},getRunData:()=>({outputs:[{dims:t?t(n):n,dataType:r[0].dataType}],dispatchGroup:{x:Math.ceil(s/64)},programUniforms:p}),getShaderSource:g}}});var AE,Nc,OE,Lc,Rc,Ow,PE,EE,zc,Pw=L(()=>{"use strict";me();_w();Iw();Ja();Aw();_r();Za();Qn();AE=(r,e,n,t,o,i)=>{let a=r[0],s=r.slice(i?1:2,i?3:4),u=s.length,l=e[0],p=e.slice(2).map((b,_)=>b+(b-1)*(n[_]-1)),g=s.map((b,_)=>b+t[_]+t[_+u]).map((b,_)=>Math.floor((b-p[_]+o[_])/o[_]));return g.splice(0,0,a),g.splice(i?3:1,0,l),g},Nc=[2,3,1,0],OE=(r,e)=>{if(!r||r.length!==2&&r.length!==3)throw new Error("Conv requires 2 or 3 inputs");if(r[0].dims.length>5)throw new Error("greater than 5D is not supported");if(r[0].dims.length!==r[1].dims.length)throw new Error("filter does not have same dimension as input");let n=r[0].dims[e.format==="NHWC"?r[0].dims.length-1:1],t=r[1].dims[1]*e.group;if(n!==t)throw new Error("FILTER_IN_CHANNEL should be equal to DATA_CHANNEL");if(r.length===3&&(r[2].dims.length!==1||r[1].dims[0]!==r[2].dims[0]))throw new Error("invalid bias");let o=r[0].dims.length-2;if(e.dilations.length!==o)throw new Error(`dilations should be ${o}D`);if(e.strides.length!==o)throw new Error(`strides should be ${o}D`);if(e.pads.length!==o*2)throw new Error(`pads should be ${o*2}D`);if(e.kernelShape.length!==0&&e.kernelShape.length!==r[1].dims.length-2)throw new Error("invalid kernel shape")},Lc=(r,e)=>{let n=r.kernelShape.slice();n.length<e[1].dims.length-2&&n.push(...Array(e[1].dims.length-2-n.length).fill(0));for(let i=2;i<e[1].dims.length;++i)n[i-2]===0&&(n[i-2]=e[1].dims[i]);let t=r.pads.slice();Vr.adjustPadsBasedOnAutoPad(e[0].dims,r.strides,r.dilations,n,t,r.format==="NHWC",r.autoPad);let o=Object.assign({},r);return Object.assign(o,{kernelShape:n,pads:t}),o},Rc=r=>{let e=ja(r),n=r.format,t=["NOTSET","VALID","SAME_UPPER","SAME_LOWER"][r.auto_pad],o=r.dilations,i=r.group,a=r.kernel_shape,s=r.pads,u=r.strides,l=r.w_is_const();return{autoPad:t,format:n,dilations:o,group:i,kernelShape:a,pads:s,strides:u,wIsConst:l,...e,cacheKey:`${r.format};${e.activation};`}},Ow=(r,e,n,t)=>{let o=n.format==="NHWC",i=AE(e[0].dims,e[1].dims,n.dilations,n.pads,n.strides,o);if(n.group!==1){let D=[e[0]];if(o){let T=r.kernelCustomData.wT??r.compute(ct(e[1],Nc),{inputs:[1],outputs:[n.wIsConst?-2:-1]})[0];n.wIsConst&&!r.kernelCustomData.wT&&(r.kernelCustomData.wT=T),D.push(T)}else D.push(e[1]);e.length===3&&D.push(e[2]),!r.adapterInfo.isArchitecture("ampere")&&o&&e[1].dims[0]===n.group&&e[1].dims[1]===1&&n.dilations[0]===1&&n.dilations[1]===1?r.compute($w(D,n,i,t),{inputs:D}):r.compute(Sw(D,n,i,t),{inputs:D});return}let a=e.length===3,s=e[0].dims[o?1:2],u=e[0].dims[o?2:3],l=e[0].dims[o?3:1],d=e[1].dims[2],p=e[1].dims[3],h=i[o?1:2],g=i[o?2:3],b=i[o?3:1],_=o&&d===s&&p===u&&n.pads[0]===0&&n.pads[1]===0;if(_||d===1&&p===1&&n.dilations[0]===1&&n.dilations[1]===1&&n.strides[0]===1&&n.strides[1]===1&&n.pads[0]===0&&n.pads[1]===0){let D=i[0],B,T,F,W=[];if(o){let V=r.kernelCustomData.wT??r.compute(ct(e[1],Nc),{inputs:[1],outputs:[n.wIsConst?-2:-1]})[0];if(n.wIsConst&&!r.kernelCustomData.wT&&(r.kernelCustomData.wT=V),_){let w=s*u*l;B=e[0].reshape([1,D,w]),T=V.reshape([1,w,b]),F=[1,D,b]}else B=e[0].reshape([D,s*u,l]),T=V.reshape([1,l,b]),F=[D,h*g,b];W.push(B),W.push(T)}else B=e[0].reshape([D,l,s*u]),T=e[1].reshape([1,b,l]),F=[D,b,h*g],W.push(T),W.push(B);a&&W.push(e[2]);let z=F[2],te=W[0].dims[W[0].dims.length-1];z<8&&te<8?r.compute(Xa(W,n,i,F,o,t),{inputs:W}):r.compute(jo(W,n,i,F,o,t),{inputs:W});return}let S=!0,v=r.kernelCustomData.wT??r.compute(ct(e[1],Nc),{inputs:[1],outputs:[n.wIsConst?-2:-1]})[0];n.wIsConst&&!r.kernelCustomData.wT&&(r.kernelCustomData.wT=v);let x=[e[0],v];a&&x.push(e[2]);let $=o?h*g:b,O=o?b:h*g,E=d*p*l;r.compute(yw(x,n,i,$,O,E,a,S,t),{inputs:x})},PE=(r,e)=>{let n=e.format==="NHWC",t=[r.inputs[0].reshape(n?[r.inputs[0].dims[0],1,r.inputs[0].dims[1],r.inputs[0].dims[2]]:[r.inputs[0].dims[0],r.inputs[0].dims[1],1,r.inputs[0].dims[2]]),r.inputs[1].reshape([r.inputs[1].dims[0],r.inputs[1].dims[1],1,r.inputs[1].dims[2]])];r.inputs.length===3&&t.push(r.inputs[2]);let o=[0,e.pads[0],0,e.pads[1]],i=[1].concat(e.strides),a=[1].concat(e.dilations),s=[1].concat(e.kernelShape),u=Lc({...e,pads:o,strides:i,dilations:a,kernelShape:s},t);Ow(r,t,u,l=>n?[l[0],l[2],l[3]]:[l[0],l[1],l[3]])},EE=(r,e,n)=>{let t=n.format==="NHWC"?"channelsLast":"channelsFirst",o=Lc(n,e),i=n.autoPad==="NOTSET"?n.pads:n.autoPad,a=xw(e[0].dims,e[1].dims,n.strides,n.dilations,i,!1,t);r.compute(Tw(e,o,a.outShape,[a.filterDepth,a.filterHeight,a.filterWidth],[a.padInfo.front,a.padInfo.top,a.padInfo.left],t))},zc=(r,e)=>{if(OE(r.inputs,e),r.inputs[0].dims.length===3)PE(r,e);else if(r.inputs[0].dims.length===5)EE(r,r.inputs,e);else{let n=Lc(e,r.inputs);Ow(r,r.inputs,n)}}});var Ew,Cw=L(()=>{"use strict";ce();Un();me();be();Ew=(r,e,n)=>{let t=r.length>2,o=e.outputShape,i=e.format==="NHWC",a=e.group,s=r[1].dims,u=s[2]/a,l=s[3],d=i?Ce(u):1,p=i&&l===1&&u>=4,h=p?Math.floor(u/4)*4:Math.floor(u/d)*d,g=u-h,b=i?Ce(l):1,_=i?l===1?d:b:1,S=k.size(o)/b,v=[Math.ceil(S/64),1,1];_e("verbose",()=>`[conv2d_backprop_webgpu] dispatch = ${v}`);let x=["rank","rank"],$=[e.strides[0],e.strides[1]],O=[e.kernelShape[i?1:2],e.kernelShape[i?2:3]],E=[e.dilations[0],e.dilations[1]],D=[O[0]+(e.dilations[0]<=1?0:(e.kernelShape[i?1:2]-1)*(e.dilations[0]-1)),O[1]+(e.dilations[1]<=1?0:(e.kernelShape[i?2:3]-1)*(e.dilations[1]-1))],B=[D[0]-1-Math.floor((e.pads[0]+e.pads[2])/2),D[1]-1-Math.floor((e.pads[1]+e.pads[3])/2)],T=[{type:12,data:S},{type:12,data:$},{type:12,data:O},{type:12,data:E},{type:12,data:D},{type:6,data:B},{type:12,data:h},{type:12,data:u},{type:12,data:l},...K(r[0].dims,r[1].dims)];t&&(T.push(...K(r[2].dims)),x.push("rank")),T.push(...K(o));let F=W=>{let z=[{name:"output_size",type:"u32"},{name:"strides",type:"u32",length:$.length},{name:"filter_dims",type:"u32",length:O.length},{name:"dilations",type:"u32",length:O.length},{name:"effective_filter_dims",type:"u32",length:D.length},{name:"pads",type:"i32",length:B.length},{name:"input_channels_per_group_int",type:"u32"},{name:"input_channels_per_group",type:"u32"},{name:"output_channels_per_group",type:"u32"}],te=Ue(r[0].dataType),V=i?1:2,w=i?2:3,R=i?3:1,j=M("W",r[1].dataType,r[1].dims.length,_),J=M("Dy",r[0].dataType,r[0].dims.length,d),Z=[J,j];t&&Z.push(M("bias",r[2].dataType,[o[R]].length,b));let oe=H("result",r[0].dataType,o.length,b),se=()=>{let fe="";if(p)d===4?fe+=`
        let xValue = ${J.getByOffset("x_offset")};
        let wValue = ${j.getByOffset("w_offset")};
        dotProd = dotProd + dot(xValue, wValue);
        x_offset += 1u;
        w_offset += 1u;`:d===2?fe+=`
          dotProd = dotProd + dot(vec4<${te}>(${J.getByOffset("x_offset")}, ${J.getByOffset("x_offset + 1u")}), vec4<${te}>(${j.getByOffset("w_offset")}, ${j.getByOffset("w_offset + 1u")}));
          x_offset += 2u;
          w_offset += 2u;`:d===1&&(fe+=`
          dotProd = dotProd + dot(vec4<${te}>(${J.getByOffset("x_offset")}, ${J.getByOffset("x_offset + 1u")}, ${J.getByOffset("x_offset + 2u")}, ${J.getByOffset("x_offset + 3u")}), vec4<${te}>(${j.getByOffset("w_offset")}, ${j.getByOffset("w_offset + 1u")}, ${j.getByOffset("w_offset + 2u")}, ${j.getByOffset("w_offset + 3u")}));
          x_offset += 4u;
          w_offset += 4u;`);else if(fe+=`
                  let xValue = ${i?J.getByOffset(`${J.indicesToOffset(`${J.type.indices}(batch, idyR, idyC, inputChannel)`)} / ${d}`):J.get("batch","inputChannel","idyR","idyC")};
        `,d===1)fe+=`
          let w_offset = ${j.indicesToOffset(`${j.type.indices}(u32(wRPerm), u32(wCPerm), inputChannel, wOutChannel)`)};
          let wValue = ${j.getByOffset(`w_offset / ${_}`)};
          dotProd = dotProd + xValue * wValue;`;else for(let U=0;U<d;U++)fe+=`
            let wValue${U} = ${j.getByOffset(`${j.indicesToOffset(`${j.type.indices}(u32(wRPerm), u32(wCPerm), inputChannel + ${U}, wOutChannel)`)} / ${_}`)};
            dotProd = dotProd + xValue[${U}] * wValue${U};`;return fe},pe=()=>{if(g===0)return"";if(!p)throw new Error(`packInputAs4 ${p} is not true.`);let fe="";if(d===1){fe+="dotProd = dotProd";for(let U=0;U<g;U++)fe+=`
            + ${J.getByOffset(`x_offset + ${U}`)} * ${j.getByOffset(`w_offset + ${U}`)}`;fe+=";"}else if(d===2){if(g!==2)throw new Error(`Invalid inputChannelsRemainder ${g}.`);fe+=`
          let xValue = ${J.getByOffset("x_offset")};
          let wValue = ${j.getByOffset("w_offset")};
          dotProd = dotProd + dot(xValue, wValue);`}return fe},De=`
            let outputIndices = ${oe.offsetToIndices(`global_idx * ${b}`)};
            let batch = ${oe.indicesGet("outputIndices",0)};
            let d1 = ${oe.indicesGet("outputIndices",R)};
            let r = ${oe.indicesGet("outputIndices",V)};
            let c = ${oe.indicesGet("outputIndices",w)};
            let dyCorner = vec2<i32>(i32(r), i32(c)) - uniforms.pads;
            let dyRCorner = dyCorner.x;
            let dyCCorner = dyCorner.y;
            let groupId = d1 / uniforms.output_channels_per_group;
            let wOutChannel = d1 - groupId * uniforms.output_channels_per_group;
            // Convolve dy(?, ?, d2) with w(:, :, d1, d2) to compute dx(xR, xC, d1).
            // ? = to be determined. : = across all values in that axis.
            var dotProd = ${oe.type.value}(0.0);
            var wR: u32 = 0;
            if (uniforms.dilations.x == 1) {
              // Minimum wR >= 0 that satisfies (dyRCorner + wR) % (uniforms.strides.x) == 0
              wR = u32(((dyRCorner + i32(uniforms.strides.x) - 1) / i32(uniforms.strides.x)) * i32(uniforms.strides.x) - dyRCorner);
            }
            for (; wR < uniforms.effective_filter_dims.x; wR = wR + 1) {
              if (wR % uniforms.dilations.x != 0) {
                continue;
              }
              let dyR = (${te}(dyRCorner) + ${te}(wR)) / ${te}(uniforms.strides[0]);
              let wRPerm = uniforms.filter_dims.x - 1 - wR / uniforms.dilations.x;
              if (dyR < 0.0 || dyR >= ${te}(uniforms.Dy_shape[${V}]) || fract(dyR) > 0.0 ||
                  wRPerm < 0) {
                continue;
              }
              let idyR: u32 = u32(dyR);
              var wC: u32 = 0;
              if (uniforms.dilations.y == 1) {
                // Minimum wC >= 0 that satisfies (dyCCorner + wC) % (uniforms.strides.y) == 0
                wC = u32(((dyCCorner + i32(uniforms.strides.y) - 1) / i32(uniforms.strides.y)) * i32(uniforms.strides.y) - dyCCorner);
              }
              for (; wC < uniforms.effective_filter_dims.y; wC = wC + 1) {
                if (wC % uniforms.dilations.y != 0) {
                  continue;
                }
                let dyC = (${te}(dyCCorner) + ${te}(wC)) / ${te}(uniforms.strides.y);
                let wCPerm = uniforms.filter_dims.y - 1 - wC / uniforms.dilations.y;
                if (dyC < 0.0 || dyC >= ${te}(uniforms.Dy_shape[${w}]) ||
                    fract(dyC) > 0.0 || wCPerm < 0) {
                  continue;
                }
                let idyC: u32 = u32(dyC);
                var inputChannel = groupId * uniforms.input_channels_per_group;
                ${p?`
                var x_offset = ${J.indicesToOffset(`${J.type.indices}(batch, idyR, idyC, inputChannel)`)} / ${d};
                var w_offset = ${j.indicesToOffset(`${j.type.indices}(wRPerm, wCPerm, inputChannel, wOutChannel)`)} / ${_};
                  `:""}
                for (var d2: u32 = 0; d2 < uniforms.input_channels_per_group_int; d2 = d2 + ${p?4:d}) {
                  ${se()}
                  inputChannel = inputChannel + ${p?4:d};
                }
                ${pe()}
                wC = wC + uniforms.strides.y - 1;
              }
              wR = wR + uniforms.strides[0] - 1;
            }
            let value = dotProd${t?` + bias[d1 / ${b}]`:""};
            ${oe.setByOffset("global_idx","value")};
          `;return`
    ${W.registerUniforms(z).declareVariables(...Z,oe)}
      ${W.mainStart()}
      ${W.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")};
    ${De}}`};return{name:"ConvTranspose2D",shaderCache:{hint:`${e.cacheKey};${d}${_}${b}${p}${g}`,inputDependencies:x},getRunData:()=>({dispatchGroup:{x:v[0],y:v[1],z:v[2]},outputs:[{dims:n?n(o):o,dataType:r[0].dataType}],programUniforms:T}),getShaderSource:F}}});var CE,DE,kE,Dw,kw,NE,Nw,LE,Lw,Rw=L(()=>{"use strict";Cw();_r();Qn();CE=(r,e,n,t,o,i)=>(r-1)*e+n+(t-1)*o+1-i,DE=(r,e,n,t,o)=>{let i=Math.floor(r/2);e==="SAME_UPPER"?(n[t]=i,n[o]=r-i):e==="SAME_LOWER"&&(n[t]=r-i,n[o]=i)},kE=(r,e,n,t,o,i,a,s,u,l)=>{let d=r.length-2,p=l.length===0;u.length<d&&u.push(...Array(d-u.length).fill(0));let h=r[0],g=e[s?3:1]*o;for(let b=0,_=r.length-d-(s?1:0);b<d;++b,++_){let S=r[_],v=p?S*a[b]:l[b],x=CE(S,a[b],i[b],e[_],n[b],v);DE(x,t,i,b,b+d),p&&l.push(a[b]*(S-1)+u[b]+(e[_]-1)*n[b]+1-i[b]-i[b+d])}l.splice(0,0,h),l.splice(s?3:1,0,g)},Dw=(r,e)=>{let n=r.kernelShape.slice();if(r.kernelShape.length===0||r.kernelShape.reduce((p,h)=>p*h,1)===0){n.length=0;for(let p=2;p<e[1].dims.length;++p)n.push(e[1].dims[p])}let t=r.format==="NHWC";n.splice(0,0,e[1].dims[0]),n.splice(t?3:1,0,e[1].dims[1]);let o=r.pads.slice(),i=r.outputShape.slice(),a=r.outputPadding.slice(),s=e[0].dims,u=r.dilations.slice();if(u.reduce((p,h)=>p+h,0)===0){let p=e[0].dims.length-2;u=new Array(p).fill(1)}let l=r.strides.slice();if(l.reduce((p,h)=>p+h,0)===0){let p=e[0].dims.length-2;l=new Array(p).fill(1)}kE(s,n,u,r.autoPad,r.group,o,l,t,a,i);let d=Object.assign({},r);return Object.assign(d,{kernelShape:n,pads:o,outputPadding:a,outputShape:i,dilations:u,strides:l}),d},kw=r=>{let e=ja(r),n=r.format,t=["NOTSET","VALID","SAME_UPPER","SAME_LOWER"][typeof r.autoPad>"u"?0:r.autoPad],o=r.dilations,i=r.group??1,a=r.kernelShape,s=r.pads,u=r.strides,l=r.wIsConst(),d=r.outputPadding,p=r.outputShape;return{autoPad:t,format:n,dilations:o,group:i,kernelShape:a,outputPadding:d,outputShape:p,pads:s,strides:u,wIsConst:l,...e,cacheKey:`${r.format};${e.activation};`}},NE=(r,e)=>{if(!r||r.length!==2&&r.length!==3)throw new Error("Conv requires 2 or 3 inputs");if(r[0].dims.length!==4&&r[0].dims.length!==3)throw new Error("currently only support 2-dimensional conv");if(r[0].dims.length!==r[1].dims.length)throw new Error("filter does not have same dimension as input");let n=r[0].dims[e.format==="NHWC"?r[0].dims.length-1:1],t=r[1].dims[0];if(n!==t)throw new Error("FILTER_IN_CHANNEL should be equal to DATA_CHANNEL");let o=r[1].dims[1]*e.group;if(r.length===3&&(r[2].dims.length!==1||r[2].dims[0]!==o))throw new Error("invalid bias");let i=r[0].dims.length-2;if(e.dilations.reduce((d,p)=>d+p,0)>0&&e.dilations.length!==i)throw new Error(`dilations should be ${i}D`);if(e.strides.reduce((d,p)=>d+p,0)>0&&e.strides.length!==i)throw new Error(`strides should be ${i}D`);if(e.pads.reduce((d,p)=>d+p,0)>0&&e.pads.length!==i*2)throw new Error(`pads should be ${i*2}D`);if(e.outputPadding.length!==i&&e.outputPadding.length!==0)throw new Error(`output_padding should be ${i}D`);if(e.kernelShape.reduce((d,p)=>d+p,0)>0&&e.kernelShape.length!==0&&e.kernelShape.length!==r[1].dims.length-2)throw new Error("invalid kernel shape");if(e.outputShape.length!==0&&e.outputShape.length!==r[0].dims.length-2)throw new Error("invalid output shape")},Nw=(r,e,n,t)=>{let o=r.kernelCustomData.wT??r.compute(ct(e[1],[2,3,0,1]),{inputs:[1],outputs:[n.wIsConst?-2:-1]})[0];n.wIsConst&&!r.kernelCustomData.wT&&(r.kernelCustomData.wT=o);let i=[e[0],o];e.length===3&&i.push(e[2]),r.compute(Ew(i,n,t),{inputs:i})},LE=(r,e)=>{let n=e.format==="NHWC",t=[r.inputs[0].reshape(n?[r.inputs[0].dims[0],1,r.inputs[0].dims[1],r.inputs[0].dims[2]]:[r.inputs[0].dims[0],r.inputs[0].dims[1],1,r.inputs[0].dims[2]]),r.inputs[1].reshape([r.inputs[1].dims[0],r.inputs[1].dims[1],1,r.inputs[1].dims[2]])];r.inputs.length===3&&t.push(r.inputs[2]);let o=e.kernelShape;(o.length===0||o[0]===0)&&(o=[r.inputs[1].dims[2]]);let i=e.dilations;(i.length===0||i[0]===0)&&(i=[1]);let a=e.strides;(a.length===0||a[0]===0)&&(a=[1]);let s=e.pads;s.length===0&&(s=[0,0]),s=[0,s[0],0,s[1]],a=[1].concat(a),i=[1].concat(i),o=[1].concat(o);let u=e.outputPadding;u=[0].concat(u);let l=Dw({...e,pads:s,strides:a,dilations:i,kernelShape:o,outputPadding:u},t);Nw(r,t,l,d=>n?[d[0],d[2],d[3]]:[d[0],d[1],d[3]])},Lw=(r,e)=>{if(NE(r.inputs,e),r.inputs[0].dims.length===3)LE(r,e);else{let n=Dw(e,r.inputs);Nw(r,r.inputs,n)}}});var RE,zw,Mw,Bw=L(()=>{"use strict";ce();me();et();be();RE=(r,e,n,t)=>{let o=k.size(e),i=e.length,a=M("input",r,i),s=H("output",r,i),u=n.dataType===6?n.getInt32Array()[0]:Number(n.getBigInt64Array()[0]),l=k.normalizeAxis(u,i),d=p=>{let h=` i32(${a.indicesGet("inputIndices","uniforms.axis")}) `,g=re("uniforms.input_shape","uniforms.axis",i),b=t.reverse?h+(t.exclusive?" + 1":""):"0",_=t.reverse?g:h+(t.exclusive?"":" + 1");return`
                ${p.registerUniform("outputSize","u32").registerUniform("axis","u32").declareVariables(a,s)}
                ${p.mainStart()}
                  ${p.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
                  var inputIndices = ${s.offsetToIndices("global_idx")};
                  var sum = ${s.type.value}(0);
                  let first : i32 = ${b};
                  let last : i32 = ${_};
                  for (var i : i32 = first; i < last; i++) {
                    ${a.indicesSet("inputIndices","uniforms.axis","u32(i)")};
                    sum = sum + ${a.getByIndices("inputIndices")};
                  }
                  ${s.setByOffset("global_idx","sum")};
                }`};return{name:"CumSum",shaderCache:{hint:t.cacheKey,inputDependencies:["rank"]},getRunData:()=>({outputs:[{dims:e,dataType:r}],dispatchGroup:{x:Math.ceil(o/64)},programUniforms:[{type:12,data:o},{type:12,data:l},...K(e,e)]}),getShaderSource:d}},zw=(r,e)=>{let n=r.inputs[0].dims,t=r.inputs[0].dataType,o=r.inputs[1];r.compute(RE(t,n,o,e),{inputs:[0]})},Mw=r=>{let e=r.exclusive===1,n=r.reverse===1;return de({exclusive:e,reverse:n})}});var zE,ME,BE,Vw,Gw,Uw=L(()=>{"use strict";ce();me();et();be();zE=r=>{if(!r||r.length!==1)throw new Error("DepthToSpace requires 1 input.");if(r[0].dims.length!==4)throw new Error("DepthToSpace requires 4D input.")},ME=(r,e,n,t)=>{let o=[];o.push(`fn perm(i: ${t.type.indices}) -> ${n.type.indices} {
    var a: ${n.type.indices};`);for(let i=0;i<e;++i)o.push(n.indicesSet("a",r[i],`i[${i}]`));return o.push("return a;}"),o.join(`
`)},BE=(r,e)=>{let n,t,o,i,a,s,u=e.format==="NHWC",l=e.blocksize,d=e.mode==="DCR";u?([n,t,o,i]=r.dims,a=d?[n,t,o,l,l,i/l**2]:[n,t,o,i/l**2,l,l],s=d?[0,1,3,2,4,5]:[0,1,4,2,5,3]):([n,t,o,i]=[r.dims[0],r.dims[2],r.dims[3],r.dims[1]],a=d?[n,l,l,i/l**2,t,o]:[n,i/l**2,l,l,t,o],s=d?[0,3,4,1,5,2]:[0,1,4,2,5,3]);let p=r.reshape(a),h=p.dims.length,g=r.dataType,b=M("a",g,h),_=H("output",g,h),S=v=>`
  ${v.registerUniform("output_size","u32").declareVariables(b,_)}

  ${ME(s,h,b,_)}

  ${v.mainStart()}
    ${v.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let indices = ${_.offsetToIndices("global_idx")};
    let aIndices = perm(indices);

    ${_.setByOffset("global_idx",b.getByIndices("aIndices"))}
  }`;return{name:"DepthToSpace",shaderCache:{hint:`${r.dims};${e.blocksize};${e.mode}`,inputDependencies:["rank"]},getRunData:v=>{let x=u?[n,t*l,o*l,i/l**2]:[n,i/l**2,t*l,o*l],$=k.size(x),O=p.dims,E=k.sortBasedOnPerm(O,s);return{outputs:[{dims:x,dataType:v[0].dataType}],dispatchGroup:{x:Math.ceil($/64)},programUniforms:[{type:12,data:$},...K(O,E)]}},getShaderSource:S}},Vw=(r,e)=>{zE(r.inputs),r.compute(BE(r.inputs[0],e))},Gw=r=>de({blocksize:r.blocksize,mode:r.mode,format:r.format})});var Mc,Qa,Fw,VE,GE,Bc,Vc,Ww,UE,Hw,qw,jw=L(()=>{"use strict";ce();me();et();be();Mc="[a-zA-Z]|\\.\\.\\.",Qa="("+Mc+")+",Fw="^"+Qa+"$",VE="("+Qa+",)*"+Qa,GE="^"+VE+"$",Bc=class{constructor(e=-1){this.symbolToIndices=new Map,this.inputIndex=e}addSymbol(e,n){let t=this.symbolToIndices.get(e);t===void 0?t=[n]:t.push(n),this.symbolToIndices.set(e,t)}},Vc=class{constructor(e,n){this.equation=n;this.hasEllipsis=!1,this.symbolToInfo=new Map,this.lhs=new Array,this.outputDims=[];let[t,o]=n.includes("->")?n.split("->",2):[n,""];if(!t.match(RegExp(GE)))throw new Error("Invalid LHS term");if(t.split(",").forEach((s,u)=>{let l=e[u].dims.slice();if(!s.match(RegExp(Fw)))throw new Error("Invalid LHS term");let d=this.processTerm(s,!0,l,u);this.lhs.push(d)}),o==="")o+=[...this.symbolToInfo.entries()].filter(([s,u])=>u.count===1||s==="...").map(([s])=>s).join("");else if(!o.match(RegExp(Qa)))throw new Error("Invalid RHS");o.match(RegExp(Mc,"g"))?.forEach(s=>{if(s==="...")this.outputDims=this.outputDims.concat(this.ellipsisDims);else{let u=this.symbolToInfo.get(s);if(u===void 0)throw new Error("Invalid RHS symbol");this.outputDims.push(u.dimValue)}}),this.rhs=this.processTerm(o,!1,this.outputDims)}addSymbol(e,n,t){let o=this.symbolToInfo.get(e);if(o!==void 0){if(o.dimValue!==n&&o.count!==1)throw new Error("Dimension mismatch");o.count++,o.inputIndices.push(t)}else o={count:1,dimValue:n,inputIndices:[t]};this.symbolToInfo.set(e,o)}processTerm(e,n,t,o=-1){let i=t.length,a=!1,s=[],u=0;if(!e.match(RegExp(Fw))&&!n&&e!=="")throw new Error("Invalid LHS term");let l=e.match(RegExp(Mc,"g")),d=new Bc(o);return l?.forEach((p,h)=>{if(p==="..."){if(a)throw new Error("Only one ellipsis is allowed per input term");a=!0;let g=i-l.length+1;if(g<0)throw new Error("Ellipsis out of bounds");if(s=t.slice(u,u+g),this.hasEllipsis){if(this.ellipsisDims.length!==s.length||this.ellipsisDims.toString()!==s.toString())throw new Error("Ellipsis dimensions mismatch")}else if(n)this.hasEllipsis=!0,this.ellipsisDims=s;else throw new Error("Ellipsis must be specified in the LHS");for(let b=0;b<s.length;b++){let _=String.fromCharCode(48+b);d.addSymbol(_,h+b),this.addSymbol(_,t[u++],o)}}else d.addSymbol(p,h+(this.hasEllipsis?this.ellipsisDims.length-1:0)),this.addSymbol(p,t[u++],o)}),d}},Ww=r=>r+"_max",UE=(r,e,n,t)=>{let i=r.map(d=>d.length).map((d,p)=>M(`input${p}`,e,d)),a=k.size(t),s=H("output",e,t.length),u=[...n.symbolToInfo.keys()].filter(d=>!n.rhs.symbolToIndices.has(d)),l=d=>{let p=[],h="var prod = 1.0;",g="var sum = 0.0;",b="sum += prod;",_=[],S=[],v=[],x=[],$=n.symbolToInfo.size===n.rhs.symbolToIndices.size;n.symbolToInfo.forEach((E,D)=>{if(n.rhs.symbolToIndices.has(D)){let B=n.rhs.symbolToIndices.get(D)?.[0];B!==void 0&&n.lhs.forEach((T,F)=>{if(E.inputIndices.includes(F)){let W=T.symbolToIndices.get(D);if(W===void 0)throw new Error("Invalid symbol error");W.forEach(z=>{p.push(`${i[F].indicesSet(`input${F}Indices`,z,s.indicesGet("outputIndices",B))}`)})}})}else n.lhs.forEach((B,T)=>{if(E.inputIndices.includes(T)){let F=B.symbolToIndices.get(D);if(F===void 0)throw new Error("Invalid symbol error");F.forEach(W=>{_.push(`${i[T].indicesSet(`input${T}Indices`,W,`${D}`)}`)}),x.push(`prod *= ${i[T].getByIndices(`input${T}Indices`)};`)}}),S.push(`for(var ${D}: u32 = 0; ${D} < uniforms.${Ww(D)}; ${D}++) {`),v.push("}")});let O=$?[...p,`let sum = ${i.map((E,D)=>E.getByIndices(`input${D}Indices`)).join(" * ")};`]:[...p,g,...S,..._,h,...x,b,...v];return`
            ${d.registerUniforms(u.map(E=>({name:`${Ww(E)}`,type:"u32"}))).registerUniform("outputSize","u32").declareVariables(...i,s)}

            ${d.mainStart()}
            ${d.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
            var outputIndices = ${s.offsetToIndices("global_idx")};
            ${i.map((E,D)=>`var input${D}Indices: ${i[D].type.indices};`).join(`
`)}
            ${O.join(`
`)};
            ${s.setByOffset("global_idx","sum")};
          }`};return{name:"Einsum",shaderCache:{hint:n.equation,inputDependencies:r.map(()=>"rank")},getRunData:()=>{let d=u.filter(h=>n.symbolToInfo.has(h)).map(h=>({type:12,data:n.symbolToInfo.get(h)?.dimValue||0}));d.push({type:12,data:a});let p=r.map((h,g)=>[...K(h)]).reduce((h,g)=>h.concat(g),d);return p.push(...K(t)),{outputs:[{dims:t,dataType:e}],dispatchGroup:{x:Math.ceil(a/64)},programUniforms:p}},getShaderSource:l}},Hw=(r,e)=>{let n=new Vc(r.inputs,e.equation),t=n.outputDims,o=r.inputs.map((i,a)=>i.dims);r.compute(UE(o,r.inputs[0].dataType,n,t))},qw=r=>{let e=r.equation.replace(/\s+/g,"");return de({equation:e})}});var FE,Kw,WE,HE,Xw,Zw=L(()=>{"use strict";ce();me();be();FE=r=>{if(!r||r.length!==2)throw new Error("Expand requires 2 input.");let e=r[0].dims,n=Array.from(r[1].getBigInt64Array(),Number),t=n.length<e.length?0:n.length-e.length,o=e.length<n.length?0:e.length-n.length;for(;t<n.length&&o<e.length;++t,++o)if(n[t]!==e[o]&&n[t]!==1&&e[o]!==1)throw new Error("Expand requires shape to be broadcastable to input")},Kw=(r,e)=>{let n=r.length-e.length,t=[];for(let o=0;o<n;++o)t.push(r[o]);for(let o=0;o<e.length;++o)t.push(e[o]===1?r[o+n]:e[o]);return t},WE=(r,e)=>r.length>e.length?Kw(r,e):Kw(e,r),HE=r=>{let e=r[0].dims,n=Array.from(r[1].getBigInt64Array(),Number),t=WE(e,n),o=r[0].dataType,i=o===9||k.size(e)===1,a=o===9||e.length>0&&e[e.length-1]%4===0?4:1,s=i||t.length>0&&t[t.length-1]%4===0?4:1,u=Math.ceil(k.size(t)/s),l=p=>{let h=M("input",o,e.length,a),g=H("output",o,t.length,s),b;if(o===9){let _=(S,v,x="")=>`
          let outputIndices${v} = ${g.offsetToIndices(`outputOffset + ${v}u`)};
          let offset${v} = ${h.broadcastedIndicesToOffset(`outputIndices${v}`,g)};
          let index${v} = offset${v} / 4u;
          let component${v} = offset${v} % 4u;
          ${S}[${v}] = ${x}(${h.getByOffset(`index${v}`)}[component${v}]);
        `;b=`
        let outputOffset = global_idx * ${s};
        var data = vec4<u32>(0);
        ${_("data",0,"u32")}
        ${_("data",1,"u32")}
        ${_("data",2,"u32")}
        ${_("data",3,"u32")}
        ${g.setByOffset("global_idx","data")}
      }`}else b=`
        let outputIndices = ${g.offsetToIndices(`global_idx * ${s}`)};
        let inputOffset = ${h.broadcastedIndicesToOffset("outputIndices",g)};
        let data = ${g.type.value}(${h.getByOffset(`inputOffset / ${a}`)});
        ${g.setByOffset("global_idx","data")}
      }`;return`
    ${p.registerUniform("vec_size","u32").declareVariables(h,g)}
    ${p.mainStart()}
    ${p.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}
    ${b}`},d=[{type:12,data:u},...K(e,t)];return{name:"Expand",shaderCache:{hint:`${t.length};${a}${s}`,inputDependencies:["rank"]},getShaderSource:l,getRunData:()=>({outputs:[{dims:t,dataType:r[0].dataType}],dispatchGroup:{x:Math.ceil(u/64)},programUniforms:d})}},Xw=r=>{FE(r.inputs),r.compute(HE(r.inputs),{inputs:[0]})}});var qE,Jw,Yw=L(()=>{"use strict";ce();me();be();qa();qE=r=>{let e=r[0].dataType,n=k.size(r[0].dims),t=k.size(r[1].dims),o=t%4===0,i=a=>{let s=M("x",e,[1],4),u=M("bias",e,[1],4),l=H("y",e,[1],4),d=[{name:"output_vec_size",type:"u32"},{name:"bias_size",type:"u32"}],p=g=>`
      let bias${g}_offset: u32 = (global_idx * 4 + ${g}) % uniforms.bias_size;
      let bias${g} = ${u.getByOffset(`bias${g}_offset / 4`)}[bias${g}_offset % 4];`,h=o?`
      let bias = ${u.getByOffset("global_idx % (uniforms.bias_size / 4)")};`:`${p(0)}${p(1)}${p(2)}${p(3)}
      let bias = ${s.type.value}(bias0, bias1, bias2, bias3);`;return`${a.registerUniforms(d).declareVariables(s,u,l)}

    ${Ec(lt(e))}

    ${a.mainStart(Gr)}
      ${a.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_vec_size")}

      let x = ${s.getByOffset("global_idx")};
      ${h}
      let x_in = x + bias;
      ${l.setByOffset("global_idx",Cc("x_in"))}
    }`};return{name:"FastGeluWithBias",shaderCache:{hint:`${o}`,inputDependencies:["type","type"]},getShaderSource:i,getRunData:a=>({outputs:[{dims:a[0].dims,dataType:a[0].dataType}],programUniforms:[{type:12,data:Math.ceil(n/4)},{type:12,data:t}],dispatchGroup:{x:Math.ceil(n/Gr/4)}})}},Jw=r=>{r.inputs.length<2||k.size(r.inputs[1].dims)===0?j0(r):r.compute(qE(r.inputs))}});var jE,KE,Qw,ev,tv=L(()=>{"use strict";ce();me();et();be();jE=r=>{if(!r||r.length!==2)throw new Error("Gather requires 2 inputs.")},KE=(r,e)=>{let n=r[0].dims,t=r[1].dims,o=n.length,i=k.normalizeAxis(e.axis,o),a=n.slice(0);a.splice(i,1,...t);let s=n[i],u=r[0].dataType===9?4:1,l=Math.ceil(k.size(a)/u),d=[{type:12,data:l},{type:6,data:s},{type:12,data:i},...K(r[0].dims,r[1].dims,a)],p=h=>{let g=M("data",r[0].dataType,r[0].dims.length,u),b=M("inputIndices",r[1].dataType,r[1].dims.length),_=H("output",r[0].dataType,a.length,u),S=x=>{let $=t.length,O=`var indicesIndices${x}  = ${b.type.indices}(0);`;for(let E=0;E<$;E++)O+=`${$>1?`indicesIndices${x}[${E}]`:`indicesIndices${x}`} = ${a.length>1?`outputIndices${x}[uniforms.axis + ${E}]`:`outputIndices${x}`};`;O+=`
          var idx${x} = ${b.getByIndices(`indicesIndices${x}`)};
          if (idx${x} < 0) {
            idx${x} = idx${x} + uniforms.axisDimLimit;
          }
          var dataIndices${x} : ${g.type.indices};
        `;for(let E=0,D=0;E<o;E++)E===i?(O+=`${o>1?`dataIndices${x}[${E}]`:`dataIndices${x}`} = u32(idx${x});`,D+=$):(O+=`${o>1?`dataIndices${x}[${E}]`:`dataIndices${x}`} = ${a.length>1?`outputIndices${x}[${D}]`:`outputIndices${x}`};`,D++);return O},v;if(r[0].dataType===9){let x=($,O,E="")=>`
          let outputIndices${O} = ${_.offsetToIndices(`outputOffset + ${O}u`)};
          ${S(O)};
          let offset${O} = ${g.indicesToOffset(`dataIndices${O}`)};
          let index${O} = offset${O} / 4u;
          let component${O} = offset${O} % 4u;
          ${$}[${O}] = ${E}(${g.getByOffset(`index${O}`)}[component${O}]);
        `;v=`
        let outputOffset = global_idx * ${u};
        var value = vec4<u32>(0);
        ${x("value",0,"u32")}
        ${x("value",1,"u32")}
        ${x("value",2,"u32")}
        ${x("value",3,"u32")}
        ${_.setByOffset("global_idx","value")}
      `}else v=`
      let outputIndices = ${_.offsetToIndices("global_idx")};
      ${S("")};
      let value = ${g.getByIndices("dataIndices")};
      ${_.setByOffset("global_idx","value")};
      `;return`
      ${h.registerUniform("outputSize","u32").registerUniform("axisDimLimit","i32").registerUniform("axis","u32").declareVariables(g,b,_)}
      ${h.mainStart()}
        ${h.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
        ${v}
      }`};return{name:"Gather",shaderCache:{hint:e.cacheKey,inputDependencies:["rank","rank"]},getRunData:()=>({outputs:[{dims:a,dataType:r[0].dataType}],dispatchGroup:{x:Math.ceil(l/64)},programUniforms:d}),getShaderSource:p}},Qw=r=>de({axis:r.axis}),ev=(r,e)=>{let n=r.inputs;jE(n),r.compute(KE(r.inputs,e))}});var XE,nv,rv,ov=L(()=>{"use strict";ce();me();be();XE=(r,e,n,t,o,i,a,s,u)=>{let l=[{type:12,data:i},{type:12,data:t},{type:12,data:o},{type:12,data:n},{type:12,data:a},{type:12,data:s},{type:12,data:u}],d=[i];l.push(...K(e.dims,d));let p=h=>{let g=M("indices_data",e.dataType,e.dims.length),b=H("input_slice_offsets_data",12,1,1),_=[g,b],S=[{name:"output_size",type:"u32"},{name:"batch_dims",type:"u32"},{name:"input_dims",type:"u32",length:o.length},{name:"sizes_from_slice_dims_data",type:"u32",length:n.length},{name:"num_slices_per_batch",type:"u32"},{name:"input_batch_stride",type:"u32"},{name:"num_slice_dims",type:"u32"}];return`
  ${h.registerUniforms(S).declareVariables(..._)}
  ${h.mainStart()}
    ${h.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let batch_idx = global_idx / uniforms.num_slices_per_batch;
    let base_offset = batch_idx * uniforms.input_batch_stride;

    let slice_indices_base_offset = global_idx * uniforms.num_slice_dims;
    var relative_slice_offset = 0;
    for (var dim_idx = 0u; dim_idx < uniforms.num_slice_dims; dim_idx ++) {
      var index = i32(indices_data[dim_idx + slice_indices_base_offset].x);
      let input_dim_idx = uniforms.batch_dims + dim_idx;
      if (index < 0) {
        ${o.length===1?"index += i32(uniforms.input_dims);":"index += i32(uniforms.input_dims[input_dim_idx]);"}
      }
      ${n.length===1?"relative_slice_offset += index * i32(uniforms.sizes_from_slice_dims_data);":"relative_slice_offset += index * i32(uniforms.sizes_from_slice_dims_data[dim_idx]);"}
    }

    input_slice_offsets_data[global_idx] =  base_offset + u32(relative_slice_offset);
  }`};return r.compute({name:"computeSliceOffsets",shaderCache:{hint:`${o.length}_${n.length}`,inputDependencies:["rank"]},getRunData:()=>({outputs:[{dims:d,dataType:r.inputs[1].dataType}],dispatchGroup:{x:Math.ceil(i/64)},programUniforms:l}),getShaderSource:p},{inputs:[e],outputs:[-1]})[0]},nv=(r,e)=>{let n=r.inputs,t=n[0].dims,o=n[0].dataType,i=n[1].dims,a=i[i.length-1],s=k.sizeToDimension(i,i.length-1),u=k.sizeFromDimension(t,e.batchDims+a),l=k.sizeToDimension(t,e.batchDims),d=k.sizeFromDimension(t,e.batchDims),p=s/l,h=new Array(a),g=u;for(let O=0;O<a;++O)h[a-1-O]=g,g*=t[e.batchDims+a-1-O];let b=XE(r,n[1],h,e.batchDims,t,s,p,d,a),_=e.batchDims+a;if(_>t.length)throw new Error("last dimension of indices must not be larger than rank of input tensor");let S=i.slice(0,-1).concat(t.slice(_)),v=k.size(S),x=[{type:12,data:v},{type:12,data:u},...K(n[0].dims,b.dims,S)],$=O=>{let E=M("data",n[0].dataType,n[0].dims.length),D=M("slice_offsets",12,b.dims.length),B=H("output",n[0].dataType,S.length);return`
          ${O.registerUniform("output_size","u32").registerUniform("slice_size","u32").declareVariables(E,D,B)}
            ${O.mainStart()}
            ${O.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
          let slice_offset = slice_offsets[global_idx / uniforms.slice_size];
          output[global_idx] = data[u32(slice_offset) + global_idx % uniforms.slice_size];
        }`};r.compute({name:"GatherND",shaderCache:{hint:e.cacheKey,inputDependencies:["rank","rank"]},getRunData:()=>({outputs:[{dims:S,dataType:o}],dispatchGroup:{x:Math.ceil(v/64)},programUniforms:x}),getShaderSource:$},{inputs:[n[0],b]})},rv=r=>({batchDims:r.batch_dims,cacheKey:""})});var ZE,JE,iv,av,sv=L(()=>{"use strict";ce();me();et();be();ZE=(r,e)=>{if(r.length<3||r.length>4)throw new Error("GatherBlockQuantized requires 3 or 4 inputs.");let n=k.normalizeAxis(e.quantizeAxis,r[0].dims.length),t=e.blockSize,o=r[0],i=r[2],a=r.length===4?r[3]:void 0;if(i.dims.length!==o.dims.length||!o.dims.map((s,u)=>u===n?Math.ceil(s/t)===i.dims[u]:s===i.dims[u]).reduce((s,u)=>s&&u,!0))throw new Error("Scales must have the same rank as the input tensor and the dims should match except on gatherAxis.");if(a){if(a.dataType!==o.dataType)throw new Error("Zero point must have the same data type as the input tensor.");if(a.dims.length!==i.dims.length||!a.dims.map((s,u)=>s===i.dims[u]).reduce((s,u)=>s&&u,!0))throw new Error("Zero point must have the same rank as the input tensor and the dims should match except on quantizeAxis.")}},JE=(r,e)=>{let n=r[0].dims,t=r[1].dims,o=n.length,i=k.normalizeAxis(e.gatherAxis,o),a=k.normalizeAxis(e.quantizeAxis,o),s=n.slice(0);s.splice(i,1,...t);let u=k.size(s),l=r[2].dataType,p=r[0].dataType===22,h=[{type:12,data:u},{type:12,data:a},{type:12,data:i},{type:12,data:e.blockSize},...K(...r.map((b,_)=>b.dims),s)],g=b=>{let _=M("data",r[0].dataType,r[0].dims.length),S=M("inputIndices",r[1].dataType,r[1].dims.length),v=M("scales",r[2].dataType,r[2].dims.length),x=r.length>3?M("zeroPoint",r[3].dataType,r[3].dims.length):void 0,$=H("output",l,s.length),O=[_,S,v];x&&O.push(x);let E=[{name:"output_size",type:"u32"},{name:"quantize_axis",type:"u32"},{name:"gather_axis",type:"u32"},{name:"block_size",type:"u32"}];return`
        ${b.registerUniforms(E).declareVariables(...O,$)}
        ${b.mainStart()}
        let output_indices = ${$.offsetToIndices("global_idx")};
        var indices_indices = ${S.type.indices}(0);
        ${t.length>1?`
          for (var i: u32 = 0; i < ${t.length}; i++) {
            let index = ${$.indicesGet("output_indices","uniforms.gather_axis + i")};
            ${S.indicesSet("indices_indices","i","index")};
          }`:`indices_indices = ${$.indicesGet("output_indices","uniforms.gather_axis")};`};
        var data_indices = ${_.type.indices}(0);
        for (var i: u32 = 0; i < uniforms.gather_axis; i++) {
          let index = ${$.indicesGet("output_indices","i")};
          ${_.indicesSet("data_indices","i","index")};
        }
        var index_from_indices = ${S.getByIndices("indices_indices")};
        if (index_from_indices < 0) {
          index_from_indices += ${n[i]};
        }
        ${_.indicesSet("data_indices","uniforms.gather_axis","u32(index_from_indices)")};
        for (var i = uniforms.gather_axis + 1; i < ${s.length}; i++) {
          let index = ${$.indicesGet("output_indices",`i + ${t.length} - 1`)};
          ${_.indicesSet("data_indices","i","index")};
        }
        let data_offset = ${_.indicesToOffset("data_indices")};
        let data_index = data_offset % 8;
        // Convert 4-bit packed data to 8-bit packed data.
        let packed_4bit_quantized_data = ${_.getByOffset("data_offset / 8")};
        let packed_8bit_quantized_data = (packed_4bit_quantized_data >> (4 * (data_index % 2))) & 0x0f0f0f0f;
        let quantized_data_vec = ${p?"unpack4xI8":"unpack4xU8"}(u32(packed_8bit_quantized_data));
        let quantized_data = quantized_data_vec[data_index / 2];
        var scale_indices = data_indices;
        let quantize_axis_index = ${v.indicesGet("data_indices","uniforms.quantize_axis")} / uniforms.block_size;
        ${v.indicesSet("scale_indices","uniforms.quantize_axis","quantize_axis_index")};
        var scale = ${v.getByIndices("scale_indices")};
        ${x?`
              let zero_point_indices = scale_indices;
              let zero_point_offset = ${x.indicesToOffset("zero_point_indices")};
              let zero_point_index = zero_point_offset % 8;
              let packed_4bit_zero_points = ${x.getByOffset("zero_point_offset / 8")};
              let packed_8bit_zero_points = (packed_4bit_zero_points >> (4 * (zero_point_index % 2))) & 0x0f0f0f0f;
              let zero_point_vec = ${p?"unpack4xI8":"unpack4xU8"}(u32(packed_8bit_zero_points));
              let zero_point = zero_point_vec[zero_point_index / 2];`:"var zero_point = 0"};
        let dequantized_data = ${lt(l)}(quantized_data - zero_point) * scale;
        ${$.setByOffset("global_idx","dequantized_data")};
    }`};return{name:"GatherBlockQuantized",shaderCache:{hint:`${e.cacheKey};${r.filter((b,_)=>_!==1).map(b=>b.dims.join("_")).join(";")}`,inputDependencies:Array.from({length:r.length},(b,_)=>"rank")},getRunData:()=>({outputs:[{dims:s,dataType:l}],dispatchGroup:{x:Math.ceil(u/64)},programUniforms:h}),getShaderSource:g}},iv=(r,e)=>{let n=r.inputs;ZE(n,e),r.compute(JE(r.inputs,e))},av=r=>de({blockSize:r.blockSize,gatherAxis:r.gatherAxis,quantizeAxis:r.quantizeAxis})});var YE,QE,uv,lv,cv=L(()=>{"use strict";ce();me();et();be();YE=r=>{if(!r||r.length!==2)throw new Error("GatherElements requires 2 inputs.");if(r[0].dims.length<1)throw new Error("GatherElements requires that the data input be rank >= 1.");if(r[0].dims.length!==r[1].dims.length)throw new Error(`GatherElements requires that the data input and
                     indices input tensors be of same rank.`)},QE=(r,e)=>{let n=r[0].dims,t=r[0].dataType,o=n.length,i=r[1].dims,a=r[1].dataType,s=k.normalizeAxis(e.axis,o),u=n[s],l=i.slice(0),d=k.size(l),p=M("input",t,o),h=M("indicesInput",a,i.length),g=H("output",t,l.length),b=[{type:12,data:d},{type:6,data:u},{type:12,data:s}];return b.push(...K(n,i,l)),{name:"GatherElements",shaderCache:{inputDependencies:["rank","rank"]},getRunData:()=>({outputs:[{dims:l,dataType:r[0].dataType}],dispatchGroup:{x:Math.ceil(d/64)},programUniforms:b}),getShaderSource:v=>`
      ${v.registerUniform("outputSize","u32").registerUniform("axisDimLimit","i32").registerUniform("axis","u32").declareVariables(p,h,g)}
      ${v.mainStart()}
      ${v.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}

      let outputIndices = ${g.offsetToIndices("global_idx")};

      var idx = ${h.getByOffset("global_idx")};
      if (idx < 0) {
        idx = idx + uniforms.axisDimLimit;
      }
      var inputIndices = ${p.type.indices}(outputIndices);
      ${p.indicesSet("inputIndices","uniforms.axis","u32(idx)")};
      let value = ${p.getByIndices("inputIndices")};

      ${g.setByOffset("global_idx","value")};
  }`}},uv=r=>de({axis:r.axis}),lv=(r,e)=>{let n=r.inputs;YE(n),r.compute(QE(r.inputs,e))}});var eC,tC,dv,pv,fv=L(()=>{"use strict";ce();me();be();eC=r=>{if(!r)throw new Error("Input is missing");if(r.length<2||r.length>3)throw new Error("Invaid input number.");if(r.length===3&&r[2].dims.length>2)throw new Error("Invalid input shape of C");if(r[0].dataType!==r[1].dataType||r.length===3&&r[0].dataType!==r[2].dataType)throw new Error("Input types are mismatched")},tC=(r,e)=>{let n=r[0].dims.slice(),t=r[1].dims.slice(),[o,i,a]=ka.getShapeOfGemmResult(n,e.transA,t,e.transB,r.length===3?r[2].dims:void 0),s=[o,i];if(!s)throw new Error("Can't use gemm on the given tensors");let u=16,l=Math.ceil(i/u),d=Math.ceil(o/u),p=!0,h=k.size(s),g=[{type:12,data:p?l:h},{type:12,data:o},{type:12,data:i},{type:12,data:a},{type:1,data:e.alpha},{type:1,data:e.beta}],b=["type","type"];r.length===3&&(g.push(...K(r[2].dims)),b.push("rank")),g.push(...K(s));let _=v=>{let x="";e.transA&&e.transB?x="value += a[k * uniforms.M + m] * b[n * uniforms.K + k];":e.transA&&!e.transB?x="value += a[k * uniforms.M + m] * b[k * uniforms.N + n];":!e.transA&&e.transB?x="value += a[m * uniforms.K + k] * b[n * uniforms.K + k];":!e.transA&&!e.transB&&(x="value += a[m * uniforms.K + k] * b[k * uniforms.N + n];");let $=e.alpha===1?"":"value *= uniforms.alpha;",O=M("a",r[0].dataType,r[0].dims),E=M("b",r[1].dataType,r[1].dims),D=O.type.value,B=null,T=[O,E];r.length===3&&(B=M("c",r[2].dataType,r[2].dims.length),T.push(B));let F=H("output",r[0].dataType,s.length);T.push(F);let W=[{name:"output_size",type:"u32"},{name:"M",type:"u32"},{name:"N",type:"u32"},{name:"K",type:"u32"},{name:"alpha",type:"f32"},{name:"beta",type:"f32"}];return`
  ${v.registerUniforms(W).declareVariables(...T)}

  ${v.mainStart()}
    ${v.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

    let m = global_idx / uniforms.N;
    let n = global_idx % uniforms.N;

    var value = ${D}(0);
    for (var k: u32 = 0u; k < uniforms.K; k++) {
      ${x}
    }

    ${$}
    ${B!=null?`let cOffset = ${B.broadcastedIndicesToOffset("vec2(m, n)",F)}; value += ${D}(uniforms.beta) * ${B.getByOffset("cOffset")};`:""}
    output[global_idx] = value;
  }`},S=v=>{let x=M("a",r[0].dataType,r[0].dims),$=M("b",r[1].dataType,r[1].dims),O=null,E=[x,$];r.length===3&&(O=M("c",r[2].dataType,r[2].dims.length),E.push(O));let D=H("output",r[0].dataType,s.length);E.push(D);let B=[{name:"num_tile_n",type:"u32"},{name:"M",type:"u32"},{name:"N",type:"u32"},{name:"K",type:"u32"},{name:"alpha",type:"f32"},{name:"beta",type:"f32"}],T="",F="";e.transA&&e.transB?(F=`
      var col = tile_row_start + local_id.x;
      var row = k_start + local_id.y;
      if (col < uniforms.M && row < uniforms.K) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.M + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${x.type.value}(0);
      }

      col = k_start + local_id.x;
      row = tile_col_start + local_id.y;
      if (col < uniforms.K && row < uniforms.N) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.K + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${$.type.value}(0);
      }
      `,T="value += tile_a[k][local_id.y] * tile_b[local_id.x][k];"):e.transA&&!e.transB?(F=`
      var col = tile_row_start + local_id.x;
      var row = k_start + local_id.y;
      if (col < uniforms.M && row < uniforms.K) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.M + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${x.type.value}(0);
      }

      col = tile_col_start + local_id.x;
      row = k_start + local_id.y;
      if (col < uniforms.N && row < uniforms.K) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.N + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${$.type.value}(0);
      }
      `,T="value += tile_a[k][local_id.y] * tile_b[k][local_id.x];"):!e.transA&&e.transB?(F=`
      var col = k_start + local_id.x;
      var row = tile_row_start + local_id.y;
      if (col < uniforms.K && row < uniforms.M) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.K + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${x.type.value}(0);
      }

      col = k_start + local_id.x;
      row = tile_col_start + local_id.y;
      if (col < uniforms.K && row < uniforms.N) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.K + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${$.type.value}(0);
      }
      `,T="value += tile_a[local_id.y][k] * tile_b[local_id.x][k];"):!e.transA&&!e.transB&&(F=`
      var col = k_start + local_id.x;
      var row = tile_row_start + local_id.y;
      if (col < uniforms.K && row < uniforms.M) {
        tile_a[local_id.y][local_id.x] = a[row * uniforms.K + col];
      } else {
        tile_a[local_id.y][local_id.x] = ${x.type.value}(0);
      }

      col = tile_col_start + local_id.x;
      row = k_start + local_id.y;
      if (col < uniforms.N && row < uniforms.K) {
        tile_b[local_id.y][local_id.x] = b[row * uniforms.N + col];
      } else {
        tile_b[local_id.y][local_id.x] = ${$.type.value}(0);
      }
      `,T="value += tile_a[local_id.y][k] * tile_b[k][local_id.x];");let W=e.alpha===1?"":"value *= uniforms.alpha;";return`
  ${v.registerUniforms(B).declareVariables(...E)}
  var<workgroup> tile_a: array<array<${x.type.storage}, ${u}>, ${u}>;
  var<workgroup> tile_b: array<array<${$.type.storage}, ${u}>, ${u}>;
  ${v.mainStart([u,u,1])}
    let tile_col_start = (workgroup_index % uniforms.num_tile_n) * ${u};
    let tile_row_start = (workgroup_index / uniforms.num_tile_n) * ${u};
    let num_tiles = (uniforms.K - 1) / ${u} + 1;
    var k_start = 0u;
    var value = ${D.type.value}(0);
    for (var t: u32 = 0u; t < num_tiles; t++) {
      ${F}
      k_start = k_start + ${u};
      workgroupBarrier();

      for (var k: u32 = 0u; k < ${u}; k++) {
        ${T}
      }
      workgroupBarrier();
    }

    ${W}
    let m = tile_row_start + local_id.y;
    let n = tile_col_start + local_id.x;
    ${O!=null?`let cOffset = ${O.broadcastedIndicesToOffset("vec2(m, n)",D)}; value += ${D.type.value}(uniforms.beta) * ${O.getByOffset("cOffset")};`:""}
    if (m < uniforms.M && n < uniforms.N) {
      output[m * uniforms.N + n] = value;
    }
  }`};return p?{name:"GemmShared",shaderCache:{hint:`${e.cacheKey}`,inputDependencies:b},getRunData:()=>({outputs:[{dims:s,dataType:r[0].dataType}],dispatchGroup:{x:l*d},programUniforms:g}),getShaderSource:S}:{name:"Gemm",shaderCache:{hint:`${e.cacheKey}`,inputDependencies:b},getRunData:()=>({outputs:[{dims:s,dataType:r[0].dataType}],dispatchGroup:{x:Math.ceil(h/64)},programUniforms:g}),getShaderSource:_}},dv=r=>{let e=r.transA,n=r.transB,t=r.alpha,o=r.beta;return{transA:e,transB:n,alpha:t,beta:o,cacheKey:`${r.transA};${r.transB};${r.alpha===1}`}},pv=(r,e)=>{eC(r.inputs),r.compute(tC(r.inputs,e))}});var er,wr,po,fo,nC,rC,oC,iC,aC,sC,uC,lC,hv,mv,gv=L(()=>{"use strict";ce();me();et();be();[er,wr,po,fo]=[0,1,2,3],nC=r=>{if(r[0].dims.length!==4)throw new Error("only 4-D tensor is supported.");if(r[0].dims.length!==r[1].dims.length)throw new Error("input dimensions must be equal to grid dimensions");if(r[0].dims.length-2!==r[1].dims[r[1].dims.length-1])throw new Error(`last dimension of grid must be equal to ${r[0].dims.length-2}`);if(r[0].dims[0]!==r[1].dims[0])throw new Error("grid batch size must match input batch size")},rC=`
  fn gs_get_cubic_coeffs(x: f32) -> vec4<f32> {
    let cubic_alpha = -0.75f;
    let x_abs = abs(x);
    var coeffs: vec4<f32>;
    coeffs[0] = (((cubic_alpha * (x_abs + 1) - 5 * cubic_alpha) * (x_abs + 1) + 8 * cubic_alpha) * (x_abs + 1) - 4 * cubic_alpha);
    coeffs[1] = (((cubic_alpha + 2) * x_abs - (cubic_alpha + 3)) * x_abs * x_abs + 1);
    coeffs[2] = (((cubic_alpha + 2) * (1 - x_abs) - (cubic_alpha + 3)) * (1 - x_abs) * (1 - x_abs) + 1);
    coeffs[3] = (((cubic_alpha * (2 - x_abs) - 5 * cubic_alpha) * (2 - x_abs) + 8 * cubic_alpha) * (2 - x_abs) - 4 * cubic_alpha);
    return coeffs;
  }
`,oC=r=>`
  fn gs_bicubic_interpolate(p: mat4x4<${r}>, x: f32, y: f32) -> ${r} {
    var v: vec4<f32>;
    var coeffs = gs_get_cubic_coeffs(x);
    for (var i = 0; i < 4; i++) {
      v[i] = coeffs[0] * p[i][0] + coeffs[1] * p[i][1] + coeffs[2] * p[i][2] + coeffs[3] * p[i][3];
    }
    coeffs = gs_get_cubic_coeffs(y);
    let pixel = ${r}(coeffs[0] * v[0] + coeffs[1] * v[1] + coeffs[2] * v[2] + coeffs[3] * v[3]);
    return pixel;
  }
`,iC=r=>`
  fn gs_denormalize(n: f32, length: i32) -> f32 {
    ${r.alignCorners===0?`
    // alignCorners: false => [-1, 1] to [-0.5, length - 0.5]
    return ((n + 1.0) * f32(length) - 1.0) / 2.0;
    `:`
    // alignCorners: true => [-1, 1] to [0, length - 1]
    return (n + 1.0) / 2.0 * (f32(length - 1));
    `}
  }
`,aC=r=>`
  ${r.paddingMode==="reflection"?`
      fn gs_reflect(x: i32, x_min: f32, x_max: f32) -> u32 {
        var dx = 0.0;
        var fx = f32(x);
        let range = x_max - x_min;
        if (fx < x_min) {
          dx = x_min - fx;
          let n = u32(dx / range);
          let r = dx - f32(n) * range;
          if (n % 2 == 0) {
            fx = x_min + r;
          } else {
            fx = x_max - r;
          }
        } else if (fx > x_max) {
          dx = fx - x_max;
          let n = u32(dx / range);
          let r = dx - f32(n) * range;
          if (n % 2 == 0) {
            fx = x_max - r;
          } else {
            fx = x_min + r;
          }
        }
        return u32(fx);
      }`:""}
`,sC=(r,e,n)=>`
  fn pixel_at_grid(r: i32, c: i32, H: i32, W: i32, batch: u32, channel: u32, border: vec4<f32>) -> ${e} {
     var pixel = ${e}(0);
     var indices = vec4<u32>(0);
     indices[${er}] = batch;
     indices[${wr}] = channel;`+(()=>{switch(n.paddingMode){case"zeros":return`
          if (r >= 0 && r < H && c >=0 && c < W) {
            indices[${po}] = u32(r);
            indices[${fo}] = u32(c);
          } else {
            return ${e}(0);
          }
        `;case"border":return`
          indices[${po}] = u32(clamp(r, 0, H - 1));
          indices[${fo}] = u32(clamp(c, 0, W - 1));
        `;case"reflection":return`
          indices[${po}] = gs_reflect(r, border[1], border[3]);
          indices[${fo}] = gs_reflect(c, border[0], border[2]);
        `;default:throw new Error(`padding mode ${n.paddingMode} is not supported`)}})()+`
    return ${r.getByIndices("indices")};
  }
`,uC=(r,e,n)=>(()=>{switch(n.mode){case"nearest":return`
          let result = pixel_at_grid(i32(round(y)), i32(round(x)), H_in, W_in, indices[${er}], indices[${wr}], border);
        `;case"bilinear":return`
          let x1 = i32(floor(x));
          let y1 = i32(floor(y));
          let x2 = x1 + 1;
          let y2 = y1 + 1;

          let p11 = pixel_at_grid(y1, x1, H_in, W_in, indices[${er}], indices[${wr}], border);
          let p12 = pixel_at_grid(y1, x2, H_in, W_in, indices[${er}], indices[${wr}], border);
          let p21 = pixel_at_grid(y2, x1, H_in, W_in, indices[${er}], indices[${wr}], border);
          let p22 = pixel_at_grid(y2, x2, H_in, W_in, indices[${er}], indices[${wr}], border);

          let dx2 = ${e}(f32(x2) - x);
          let dx1 = ${e}(x - f32(x1));
          let dy2 = ${e}(f32(y2) - y);
          let dy1 = ${e}(y - f32(y1));
          let result = dy2 * (dx2 * p11 + dx1 * p12) + dy1 * (dx2 * p21 + dx1 * p22);
        `;case"bicubic":return`
          let x0 = i32(floor(x)) - 1;
          let y0 = i32(floor(y)) - 1;
          var p: mat4x4<${e}>;
          for (var h = 0; h < 4; h++) {
            for (var w = 0; w < 4; w++) {
              p[h][w] = pixel_at_grid(h + y0, w + x0, H_in, W_in, indices[${er}], indices[${wr}], border);
            }
          }

          let dx = x - f32(x0 + 1);
          let dy = y - f32(y0 + 1);
          let result = gs_bicubic_interpolate(p, dx, dy);
        `;default:throw new Error(`mode ${n.mode} is not supported`)}})()+`${r.setByOffset("global_idx","result")}`,lC=(r,e)=>{let n=M("x",r[0].dataType,r[0].dims.length),t=[r[1].dims[0],r[1].dims[1],r[1].dims[2]],o=M("grid",r[1].dataType,t.length,2),i=[r[0].dims[0],r[0].dims[1],r[1].dims[1],r[1].dims[2]];e.format==="NHWC"&&(i=[r[0].dims[0],r[1].dims[1],r[1].dims[2],r[0].dims[3]],[er,wr,po,fo]=[0,3,1,2]);let a=H("output",r[0].dataType,i.length),s=n.type.value,u=k.size(i),l=[{type:12,data:u},...K(r[0].dims,t,i)],d=p=>`
  ${p.registerUniform("output_size","u32").declareVariables(n,o,a)}
  ${rC}
  ${oC(s)}
  ${iC(e)}
  ${aC(e)}
  ${sC(n,s,e)}

  ${p.mainStart()}
    ${p.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
      let H_in = i32(uniforms.x_shape[${po}]);
      let W_in = i32(uniforms.x_shape[${fo}]);

      ${e.alignCorners===0?`
      let x_min = -0.5;
      let x_max = f32(W_in) - 0.5;
      let y_min = -0.5;
      let y_max = f32(H_in) - 0.5;
      `:`
      let x_min = 0.0;
      let x_max = f32(W_in) - 1.0;
      let y_min = 0.0;
      let y_max = f32(H_in) - 1.0;
      `};
      let border = vec4<f32>(x_min, y_min, x_max, y_max);

      let indices = ${a.offsetToIndices("global_idx")};
      var grid_indices = vec3<u32>(indices[${er}], indices[${po}], indices[${fo}]);
      let nxy = ${o.getByIndices("grid_indices")};
      var x = gs_denormalize(f32(nxy[0]), W_in);
      var y = gs_denormalize(f32(nxy[1]), H_in);

      ${uC(a,s,e)}
  }`;return{name:"GridSample",shaderCache:{hint:`${e.cacheKey}`,inputDependencies:["type","type"]},getRunData:p=>{let h=k.size(i);return{outputs:[{dims:i,dataType:p[0].dataType}],dispatchGroup:{x:Math.ceil(h/64)},programUniforms:l}},getShaderSource:d}},hv=(r,e)=>{nC(r.inputs),r.compute(lC(r.inputs,e))},mv=r=>de({alignCorners:r.align_corners,mode:r.mode,paddingMode:r.padding_mode,format:r.format})});var It,pC,yv,bv,fC,Ko,_v,Gc=L(()=>{"use strict";ce();me();et();Ba();Wa();be();Qn();It=(r,e)=>r.length>e&&r[e].dims.length>0?r[e]:void 0,pC=(r,e)=>{let n=r[0],t=It(r,1),o=It(r,2),i=It(r,3),a=It(r,4),s=It(r,5),u=It(r,6),l=It(r,7);if(n.dims.length!==3&&n.dims.length!==5)throw new Error("Input query is expected to have 3 or 5 dimensions");let d=n.dims[0],p=n.dims[1],h=n.dims.length===3?n.dims[2]:e.numHeads*n.dims[4],g=p,b=0,_=0,S=Math.floor(h/e.numHeads);if(u&&l&&k.size(u.dims)&&k.size(l.dims)){if(u.dims.length!==4)throw new Error('Input "past_key" is expected to have 4 dimensions');if(u.dims[0]!==d||u.dims[1]!==e.numHeads||u.dims[3]!==S)throw new Error('Input "past_key" shape (batch_size, num_heads, past_sequence_length, head_size)');if(l.dims[0]!==d||l.dims[1]!==e.numHeads||l.dims[3]!==S)throw new Error('Input "past_value" shape (batch_size, num_heads, past_sequence_length, head_size)');if(u.dims[2]!==l.dims[2])throw new Error('Input "past_key" and "past_value" shall have same dim 2 (past_sequence_length)');if(l.dims.length!==4)throw new Error('Input "past_value" is expected to have 4 dimensions');b=u.dims[2],_=u.dims[2]}else if(u&&k.size(u.dims)||l&&k.size(l.dims))throw new Error('Input "past_key" and "past_value" shall be both present or both absent');let v;if(t&&k.size(t.dims)>0){if(n.dims.length!==3)throw new Error('Input "query" is expected to have 3 dimensions when key is given');if(t.dims.length<3||t.dims.length>5)throw new Error('Input "key" is expected to have 3, 4, or 5 dimensions');if(n.dims[0]!==t.dims[0])throw new Error('Input "query" and "key" shall have same dim 0 (batch size)');if(t.dims.length===3){if(t.dims[2]!==n.dims[2])throw new Error('Input "query" and "key" shall have same dim 2 (hidden_size)');v=2,g=t.dims[1]}else if(t.dims.length===5){if(t.dims[2]!==e.numHeads||t.dims[3]!==2||t.dims[4]!==S)throw new Error('Expect "key" shape (batch_size, kv_sequence_length, num_heads, 2, head_size) for packed kv');if(o)throw new Error('Expect "value" be none when "key" has packed kv format.');v=5,g=t.dims[1]}else{if(t.dims[1]!==e.numHeads||t.dims[3]!==S)throw new Error('Expect "key" shape (batch_size, num_heads, kv_sequence_length, head_size) for past_key');v=0,g=t.dims[2]}}else{if(n.dims.length!==5)throw new Error('Input "query" is expected to have 5 dimensions when key is empty');if(n.dims[2]!==e.numHeads||n.dims[3]!==3)throw new Error('Expect "query" shape (batch_size, kv_sequence_length, num_heads, 3, head_size) for packed kv');v=3}if(i&&k.size(i.dims)>0){if(i.dims.length!==1)throw new Error('Input "bias" is expected to have 1 dimension');if(t&&t.dims.length===5&&t.dims[3]===2)throw new Error("bias is not allowed for packed kv.")}let x=b+g,$=0;if(a&&k.size(a.dims)>0){$=8;let B=a.dims;throw B.length===1?B[0]===d?$=1:B[0]===3*d+2&&($=3):B.length===2&&B[0]===d&&B[1]===x&&($=5),$===8?new Error('Input "key_padding_mask" shape shall be (batch_size) or (batch_size, total_sequence_length)'):new Error("Mask not supported")}let O=!1,E=h;if(o&&k.size(o.dims)>0){if(o.dims.length!==3&&o.dims.length!==4)throw new Error('Input "value" is expected to have 3 or 4 dimensions');if(n.dims[0]!==o.dims[0])throw new Error('Input "query" and "value" shall have same dim 0 (batch_size)');if(o.dims.length===3){if(g!==o.dims[1])throw new Error('Input "key" and "value" shall have the same dim 1 (kv_sequence_length)');E=o.dims[2]}else{if(g!==o.dims[2])throw new Error('Input "key" and "value" shall have the same dim 2 (kv_sequence_length)');E=o.dims[1]*o.dims[3],O=!0}}let D=!1;if(a&&k.size(a.dims)>0)throw new Error("Key padding mask is not supported");if(s&&k.size(s.dims)>0){if(s.dims.length!==4)throw new Error('Input "attention_bias" is expected to have 4 dimensions');if(s.dims[0]!==d||s.dims[1]!==e.numHeads||s.dims[2]!==p||s.dims[3]!==x)throw new Error('Expect "attention_bias" shape (batch_size, num_heads, sequence_length, total_sequence_length)')}return{batchSize:d,sequenceLength:p,pastSequenceLength:b,kvSequenceLength:g,totalSequenceLength:x,maxSequenceLength:_,inputHiddenSize:0,hiddenSize:h,vHiddenSize:E,headSize:S,vHeadSize:Math.floor(E/e.numHeads),numHeads:e.numHeads,isUnidirectional:!1,pastPresentShareBuffer:!1,maskFilterValue:e.maskFilterValue,maskType:$,scale:e.scale,broadcastResPosBias:D,passPastInKv:O,qkvFormat:v}},yv=r=>de({...r}),bv=de({perm:[0,2,1,3]}),fC=(r,e,n,t,o,i,a)=>{let s=[t,o,i],u=k.size(s),l=[{type:12,data:u},{type:12,data:a},{type:12,data:i}],d=p=>{let h=H("qkv_with_bias",e.dataType,s),g=M("qkv",e.dataType,s),b=M("bias",n.dataType,s),_=[{name:"output_size",type:"u32"},{name:"bias_offset",type:"u32"},{name:"hidden_size",type:"u32"}];return`
  ${p.registerUniforms(_).declareVariables(g,b,h)}
  ${p.mainStart()}
    ${p.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let bias_offset_idx = (global_idx % uniforms.hidden_size) + uniforms.bias_offset;

    qkv_with_bias[global_idx] = qkv[global_idx] + bias[bias_offset_idx];
  }`};return r.compute({name:"MultiHeadAttentionAddBias",shaderCache:{inputDependencies:["type","type"]},getRunData:()=>({outputs:[{dims:s,dataType:e.dataType,gpuDataType:0}],dispatchGroup:{x:Math.ceil(u/64)},programUniforms:l}),getShaderSource:d},{inputs:[e,n],outputs:[-1]})[0]},Ko=(r,e,n,t,o,i,a,s)=>{let u=i;if(a&&k.size(a.dims)>0){if(t===1)throw new Error("AddBiasReshape is not implemented. Please export your model with packed QKV or KV");return u=fC(r,i,a,e,t,n*o,s),u=u.reshape([e,t,n,o]),n===1||t===1?u:r.compute(ct(u,bv.perm),{inputs:[u],outputs:[-1]})[0]}else return i.dims.length===3&&(u=i.reshape([e,t,n,o])),n===1||t===1?u:r.compute(ct(u,bv.perm),{inputs:[u],outputs:[-1]})[0]},_v=(r,e)=>{let n=pC(r.inputs,e),t=r.inputs[0],o=It(r.inputs,1),i=It(r.inputs,2),a=It(r.inputs,3),s=It(r.inputs,4),u=It(r.inputs,5),l=It(r.inputs,6),d=It(r.inputs,7);if(t.dims.length===5)throw new Error("Packed QKV is not implemented");if(o?.dims.length===5)throw new Error("Packed KV is not implemented");let p=o&&i&&o.dims.length===4&&i.dims.length===4,h=Ko(r,n.batchSize,n.numHeads,n.sequenceLength,n.headSize,t,a,0);if(p)return co(r,h,o,i,s,void 0,l,d,u,n);if(!o||!i)throw new Error("key and value must be provided");let g=Ko(r,n.batchSize,n.numHeads,n.kvSequenceLength,n.headSize,o,a,n.hiddenSize),b=Ko(r,n.batchSize,n.numHeads,n.kvSequenceLength,n.vHeadSize,i,a,2*n.hiddenSize);co(r,h,g,b,s,void 0,l,d,u,n)}});var hC,mC,gC,bC,Uc,wv,vv,Fc=L(()=>{"use strict";ce();me();et();be();hC=r=>{if(!r||r.length<1)throw new Error("too few inputs")},mC=(r,e)=>{let n=[],t=e.numOutputs;return r[1].dims[0]>0&&(r[1].getBigInt64Array().forEach(o=>n.push(Number(o))),t=n.length),de({numOutputs:t,axis:e.axis,splitSizes:n})},gC=r=>`
fn calculateOutputIndex(index: u32) -> u32 {
    for (var i: u32 = 0u; i < ${r}u; i += 1u ) {
    if (index < ${re("uniforms.size_in_split_axis","i",r)}) {
        return i;
    }
    }
    return ${r}u;
}`,bC=r=>{let e=r.length,n=[];for(let t=0;t<e;++t){let o=r[t].setByIndices("indices","input[global_idx]");e===1?n.push(o):t===0?n.push(`if (output_number == ${t}u) { ${o} }`):t===e-1?n.push(`else { ${o} }`):n.push(`else if (output_number == ${t}) { ${o} }`)}return`
      fn writeBufferData(output_number: u32, indices: ${r[0].type.indices}, global_idx: u32) {
        ${n.join(`
`)}
      }`},Uc=(r,e)=>{let n=r[0].dims,t=k.size(n),o=r[0].dataType,i=k.normalizeAxis(e.axis,n.length),a=new Array(e.numOutputs),s=M("input",o,n.length),u=new Array(e.numOutputs),l=[],d=[],p=0,h=[{type:12,data:t}];for(let b=0;b<e.numOutputs;b++){p+=e.splitSizes[b],u[b]=p;let _=n.slice();_[i]=e.splitSizes[b],d.push(_),a[b]=H(`output${b}`,o,_.length),l.push({dims:d[b],dataType:r[0].dataType})}h.push({type:12,data:u},...K(n,...d));let g=b=>`
  ${b.registerUniform("input_size","u32").registerUniform("size_in_split_axis","u32",u.length).declareVariables(s,...a)}
  ${gC(u.length)}
  ${bC(a)}

  ${b.mainStart()}
    ${b.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.input_size")}

    var indices = ${s.offsetToIndices("global_idx")};
    var index = ${s.indicesGet("indices",i)};
    let output_number = calculateOutputIndex(index);
    if (output_number != 0) {
      index -= ${re("uniforms.size_in_split_axis","output_number - 1u",u.length)};
      ${s.indicesSet("indices",i,"index")};
    }
    writeBufferData(output_number, indices, global_idx);
  }`;return{name:"Split",shaderCache:{hint:e.cacheKey,inputDependencies:["rank"]},getShaderSource:g,getRunData:()=>({outputs:l,dispatchGroup:{x:Math.ceil(t/64)},programUniforms:h})}},wv=(r,e)=>{hC(r.inputs);let n=r.inputs.length===1?e:mC(r.inputs,e);r.compute(Uc(r.inputs,n),{inputs:[0]})},vv=r=>{let e=r.axis,n=r.splitSizes,t=r.numOutputs<0?n.length:r.numOutputs;if(t!==n.length)throw new Error("numOutputs and splitSizes length must be equal");return de({axis:e,numOutputs:t,splitSizes:n})}});var yC,es,xv,Wc=L(()=>{"use strict";ce();me();et();be();yC=(r,e)=>{let[n,t,o,i]=r,{numHeads:a,rotaryEmbeddingDim:s}=e;if(n.dims.length!==3&&n.dims.length!==4)throw new Error(`Input 'x' is expected to have 3 or 4 dimensions, got ${n.dims.length}`);if(!k.areEqual(t.dims,[])&&!k.areEqual(t.dims,[1])&&t.dims.length!==2)throw new Error(`Input 'position_ids' is expected to have 0, 1, or 2 dimensions, got ${t.dims.length}`);if(o.dims.length!==2)throw new Error(`Input 'cos_cache' is expected to have 2 dimensions, got ${o.dims.length}`);if(i.dims.length!==2)throw new Error(`Input 'sin_cache' is expected to have 2 dimensions, got ${i.dims.length}`);if(!k.areEqual(o.dims,i.dims))throw new Error("Inputs 'cos_cache' and 'sin_cache' are expected to have the same shape");if(s>0&&a===0)throw new Error("num_heads must be provided if rotary_embedding_dim is specified");let u=n.dims[0],l=n.dims[n.dims.length-2],d=o.dims[0],p=k.sizeFromDimension(n.dims,1)/l,h=s===0?o.dims[1]*2:p/a;if(s>h)throw new Error("rotary_embedding_dim must be less than or equal to head_size");if(t.dims.length===2){if(u!==t.dims[0])throw new Error(`Input 'position_ids' dimension 0 should be of size batch_size, got ${t.dims[0]}`);if(l!==t.dims[1])throw new Error(`Input 'position_ids' dimension 1 should be of size sequence_length, got ${t.dims[1]}`)}if(l>d)throw new Error("Updating cos_cache and sin_cache in RotaryEmbedding is not currently supported");if(h/2!==o.dims[1]&&s/2!==o.dims[1])throw new Error(`Input 'cos_cache' dimension 1 should be same as head_size / 2 or rotary_embedding_dim / 2, got ${o.dims[1]}`)},es=(r,e)=>{let{interleaved:n,numHeads:t,rotaryEmbeddingDim:o,scale:i}=e,a=r[0].dims[0],s=k.sizeFromDimension(r[0].dims,1),u=r[0].dims[r[0].dims.length-2],l=s/u,d=r[2].dims[1],p=o===0?d*2:l/t,h=new Array(a,u,l/p,p-d),g=k.computeStrides(h),b=[{type:1,data:i},{type:12,data:h},{type:12,data:g},...r[0].dims.length===3?new Array({type:12,data:[s,l,p,1]}):[],...r[0].dims.length===4?new Array({type:12,data:[s,p,u*p,1]}):[],...K(r[0].dims,r[1].dims,r[2].dims,r[3].dims,r[0].dims)],_=S=>{let v=M("input",r[0].dataType,r[0].dims.length),x=M("position_ids",r[1].dataType,r[1].dims.length),$=M("cos_cache",r[2].dataType,r[2].dims.length),O=M("sin_cache",r[3].dataType,r[3].dims.length),E=H("output",r[0].dataType,r[0].dims.length);return S.registerUniforms([{name:"scale",type:"f32"},{name:"global_shape",type:"u32",length:h.length},{name:"global_strides",type:"u32",length:g.length},{name:"input_output_strides",type:"u32",length:g.length}]),`
        ${S.declareVariables(v,x,$,O,E)}

        ${S.mainStart(Gr)}
          let half_rotary_emb_dim = uniforms.${$.name}_shape[1];
          let bsnh = global_idx / uniforms.global_strides % uniforms.global_shape;
          let size = uniforms.global_shape[0] * uniforms.global_strides[0];
          ${S.guardAgainstOutOfBoundsWorkgroupSizes("size")}

          if (bsnh[3] < half_rotary_emb_dim) {
            let position_ids_idx =
                ${x.broadcastedIndicesToOffset("bsnh.xy",H("",x.type.tensor,2))};
            let position_id =
                u32(${x.getByOffset("position_ids_idx")}) + select(0, bsnh[1], position_ids_idx == 0);
            let i = dot(bsnh, uniforms.input_output_strides) + select(0, bsnh[3], ${n});
            let j = i + select(half_rotary_emb_dim, 1, ${n});
            let re = ${v.getByOffset("i")} * ${$.get("position_id","bsnh[3]")} -
                ${v.getByOffset("j")} * ${O.get("position_id","bsnh[3]")};
            ${E.setByOffset("i","re")}
            let im = ${v.getByOffset("i")} * ${O.get("position_id","bsnh[3]")} +
                ${v.getByOffset("j")} * ${$.get("position_id","bsnh[3]")};
            ${E.setByOffset("j","im")}
          } else {
            let k = dot(bsnh, uniforms.input_output_strides) + half_rotary_emb_dim;
            ${E.setByOffset("k",v.getByOffset("k"))}
          }
        }`};return{name:"RotaryEmbedding",shaderCache:{hint:de({interleaved:n}).cacheKey,inputDependencies:["rank","rank","rank","rank"]},getShaderSource:_,getRunData:()=>({outputs:[{dims:r[0].dims,dataType:r[0].dataType}],dispatchGroup:{x:Math.ceil(k.size(h)/Gr)},programUniforms:b})}},xv=(r,e)=>{yC(r.inputs,e),r.compute(es(r.inputs,e))}});var _C,wC,Tv,vC,Iv,Sv=L(()=>{"use strict";et();ce();Wa();Gc();Fc();Qn();Wc();be();_C=(r,e)=>{if(e.doRotary&&r.length<=7)throw new Error("cos_cache and sin_cache inputs are required if do_rotary is specified");let n=r[0],t=r[1],o=r[2],i=r[3],a=r[4];if(e.doRotary!==0&&r.length<=7)throw new Error("cos_cast and sin_cache are expected if do_rotary attribute is non-zero");if(e.localWindowSize!==-1)throw new Error("Local attention is not supported");if(e.softcap!==0)throw new Error("Softcap is not supported");if(e.rotaryInterleaved!==0)throw new Error("Rotary interleaved is not supported");if(e.smoothSoftmax)throw new Error("Smooth softmax is not supported");if(n.dims.length!==3&&n.dims.length!==5)throw new Error("Input query is expected to have 3 or 5 dimensions");let s=!1,u=n.dims[0],l=n.dims[1],d=n.dims.length===3?s?n.dims[2]/3:n.dims[2]:e.numHeads*n.dims[4],p=l,h=0,g=!t||t.dims.length===0,b=Math.floor(g?d/(e.numHeads+2*e.kvNumHeads):d/e.numHeads);g&&(d=b*e.numHeads);let _=i&&i.dims.length!==0,S=a&&a.dims.length!==0;if(_&&i.dims.length===4&&i.dims[0]===u&&i.dims[1]!==e.kvNumHeads&&i.dims[2]===e.kvNumHeads&&i.dims[3]===b)throw new Error("BSNH pastKey/pastValue is not supported");if(_&&S){if(i.dims.length!==4)throw new Error('Input "past_key" is expected to have 4 dimensions');if(a.dims.length!==4)throw new Error('Input "past_value" is expected to have 4 dimensions');h=i.dims[2]}else if(_||S)throw new Error('Input "past_key" and "past_value" shall be both present or both absent');let x=1;if(t&&t.dims.length>0){if(n.dims.length!==3)throw new Error('Input "query" is expected to have 3 dimensions when key is given');if(t.dims.length<3||t.dims.length>5)throw new Error('Input "key" is expected to have 3, 4, or 5 dimensions');if(n.dims[0]!==t.dims[0])throw new Error('Input "query" and "key" shall have same dim 0 (batch size)');if(t.dims.length===3){if(n.dims[2]%t.dims[2]!==0)throw new Error('Dimension 2 of "query" should be a multiple of "key"');p=t.dims[1]}else if(t.dims.length===5){if(t.dims[2]!==e.numHeads||t.dims[3]!==2||t.dims[4]!==b)throw new Error('Expect "key" shape (batch_size, kv_sequence_length, num_heads, 2, head_size) for packed kv');if(o)throw new Error('Expect "value" be none when "key" has packed kv format.');p=t.dims[1]}else{if(t.dims[1]!==e.numHeads||t.dims[3]!==b)throw new Error('Expect "key" shape (batch_size, num_heads, kv_sequence_length, head_size) for past_key');p=t.dims[2]}}else{if(n.dims.length!==3&&n.dims.length!==5)throw new Error('Input "query" is expected to have 3 or 5 dimensions when key is empty');if(n.dims.length===5&&(n.dims[2]!==e.numHeads||n.dims[3]!==3))throw new Error('Expect "query" shape (batch_size, kv_sequence_length, num_heads, 3, head_size) for packed kv');x=3}let $=0,O=!1,E=e.kvNumHeads?b*e.kvNumHeads:d;if(o&&o.dims.length>0){if(o.dims.length!==3&&o.dims.length!==4)throw new Error('Input "value" is expected to have 3 or 4 dimensions');if(n.dims[0]!==o.dims[0])throw new Error('Input "query" and "value" shall have same dim 0 (batch_size)');if(o.dims.length===3){if(p!==o.dims[1])throw new Error('Input "key" and "value" shall have the same dim 1 (kv_sequence_length)');E=o.dims[2]}else{if(p!==o.dims[2])throw new Error('Input "past_key" and "past_value" shall have the same dim 2 (kv_sequence_length)');E=o.dims[1]*o.dims[3],O=!0}}let D=r.length>4?r[5]:void 0;if(D){if(D.dims.length===0)throw new Error("seqlens_k must be at least 1D, got scalar.");let W=D.dims.reduce((z,te)=>z*te,1);if(W!==u)throw new Error(`seqlens_k must have batch_size (${u}) elements, got ${W}.`);for(let z=0;z<D.dims.length;z++)if(D.dims[z]!==1&&D.dims[z]!==u)throw new Error(`seqlens_k has unexpected shape. Each dimension must be 1 or batch_size (${u}), got dims[${z}] = ${D.dims[z]}.`)}return{batchSize:u,sequenceLength:l,pastSequenceLength:h,kvSequenceLength:p,totalSequenceLength:-1,maxSequenceLength:-1,inputHiddenSize:0,hiddenSize:d,vHiddenSize:E,headSize:b,vHeadSize:Math.floor(E/e.kvNumHeads),numHeads:e.numHeads,kvNumHeads:e.kvNumHeads,nReps:e.numHeads/e.kvNumHeads,pastPresentShareBuffer:!1,maskType:$,scale:e.scale,broadcastResPosBias:!1,passPastInKv:O,qkvFormat:x}},wC=de({perm:[0,2,1,3]}),Tv=(r,e,n)=>{let t=e,o=n.kvNumHeads;return e.dims.length===3&&n.kvSequenceLength!==0&&(t=e.reshape([n.batchSize,n.kvSequenceLength,o,n.headSize]),t=r.compute(ct(t,wC.perm),{inputs:[t],outputs:[-1]})[0]),t},vC=(r,e,n,t)=>{let o=7,i=["type","type"],a=[r*e],s=r*e,u=[{type:12,data:s},{type:12,data:e},{type:12,data:r}],l=d=>{let p=M("seq_lens",n.dataType,n.dims),h=M("total_seq_lens",t.dataType,t.dims),g=H("pos_ids",o,a),b=[{name:"output_size",type:"u32"},{name:"sequence_length",type:"u32"},{name:"batch_size",type:"u32"}];return`
  ${d.registerUniforms(b).declareVariables(p,h,g)}
  ${d.mainStart()}
    ${d.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
    let total_sequence_length = u32(${h.getByOffset("0")});
    let is_subsequent_prompt = uniforms.sequence_length > 1 && uniforms.sequence_length != total_sequence_length;
    let is_first_prompt = !is_subsequent_prompt && uniforms.sequence_length == total_sequence_length;
    let batch_idx = global_idx / uniforms.sequence_length;
    let sequence_idx = i32(global_idx % uniforms.sequence_length);
    var pos_id: i32 = 0;
    let seqlen = ${p.getByOffset("batch_idx")};
    let total_seqlen = seqlen + 1;
    if (is_first_prompt) {
      if (sequence_idx < total_seqlen) {
        pos_id = sequence_idx;
      } else {
        pos_id = 1;
      }
      ${g.setByOffset("global_idx","pos_id")}
    } else if (is_subsequent_prompt) {
      let past_seqlen = total_seqlen - i32(uniforms.sequence_length);
      if (past_seqlen + sequence_idx < total_seqlen) {
        pos_id = past_seqlen + sequence_idx;
      } else {
        pos_id = 1;
      }
      ${g.setByOffset("global_idx","pos_id")}
    } else if (global_idx < uniforms.batch_size) {
      ${g.setByOffset("global_idx","seqlen")}
    };
  }
  `};return{name:"GeneratePositionIds",shaderCache:{hint:`${r};${e}`,inputDependencies:i},getRunData:()=>({outputs:[{dims:a,dataType:o}],dispatchGroup:{x:Math.ceil(s/64)},programUniforms:u}),getShaderSource:l}},Iv=(r,e)=>{let n=_C(r.inputs,e);if(r.inputs[0].dims.length===5)throw new Error("Packed QKV is not implemented");if(r.inputs[1]?.dims.length===5)throw new Error("Packed KV is not implemented");let t=r.inputs[0],o=r.inputs[1]&&r.inputs[1].dims.length>0?r.inputs[1]:void 0,i=r.inputs[2]&&r.inputs[2].dims.length>0?r.inputs[2]:void 0,a=r.inputs[3]&&r.inputs[3].dims.length!==0?r.inputs[3]:void 0,s=r.inputs[4]&&r.inputs[4].dims.length!==0?r.inputs[4]:void 0,u=r.inputs.length>4?r.inputs[5]:void 0,l=r.inputs.length>5?r.inputs[6]:void 0,d=n.kvNumHeads?n.kvNumHeads:n.numHeads,p=de({axis:2,numOutputs:3,splitSizes:[n.numHeads*n.headSize,d*n.headSize,d*n.headSize]}),[h,g,b]=!o&&!i?r.compute(Uc([t],p),{inputs:[t],outputs:[-1,-1,-1]}):[t,o,i],_,S;if(e.doRotary){let O=r.compute(vC(n.batchSize,n.sequenceLength,u,l),{inputs:[u,l],outputs:[-1]})[0],E=r.inputs[7],D=r.inputs[8],B=de({interleaved:e.rotaryInterleaved!==0,numHeads:n.numHeads,rotaryEmbeddingDim:0,scale:e.scale}),T=[h,O,E,D],F=[-1];_=r.compute(es(T,B),{inputs:T,outputs:F})[0],T.splice(0,1,g);let W=de({interleaved:e.rotaryInterleaved!==0,numHeads:n.kvNumHeads,rotaryEmbeddingDim:0,scale:e.scale});S=r.compute(es(T,W),{inputs:T,outputs:F})[0]}let v=Ko(r,n.batchSize,n.numHeads,n.sequenceLength,n.headSize,e.doRotary?_:h,void 0,0),x=Tv(r,e.doRotary?S:g,n),$=Tv(r,b,n);co(r,v,x,$,void 0,void 0,a,s,void 0,n,u,l)}});var $v,xC,TC,Av,Ov=L(()=>{"use strict";ce();me();Qn();be();$v=(r,e,n,t,o,i,a,s)=>{let u=Ce(i),l=u===1?"f32":`vec${u}f`,d=u===1?"vec2f":`mat2x${u}f`,p=o*a,h=64;p===1&&(h=256);let g=[o,a,i/u],b=[o,a,2],_=["rank","type","type"],S=[];S.push(...K(g,b));let v=x=>{let $=M("x",e.dataType,3,u),O=M("scale",n.dataType,n.dims),E=M("bias",t.dataType,t.dims),D=H("output",1,3,2),B=[$,O,E,D];return`
  var<workgroup> workgroup_shared : array<${d}, ${h}>;
  const workgroup_size = ${h}u;
  ${x.declareVariables(...B)}
  ${x.mainStart(h)}
    let batch = workgroup_index / uniforms.x_shape[1];
    let channel = workgroup_index % uniforms.x_shape[1];
    let hight = uniforms.x_shape[2];
    // initialize workgroup memory
    var sum = ${l}(0);
    var squared_sum = ${l}(0);
    for (var h = local_idx; h < hight; h += workgroup_size) {
      let value = ${l}(${$.get("batch","channel","h")});
      sum += value;
      squared_sum += value * value;
    }
    workgroup_shared[local_idx] = ${d}(sum, squared_sum);
    workgroupBarrier();

    for (var currSize = workgroup_size >> 1;  currSize > 0; currSize = currSize >> 1) {
      if (local_idx < currSize) {
        workgroup_shared[local_idx] = workgroup_shared[local_idx] + workgroup_shared[local_idx + currSize];
      }
      workgroupBarrier();
    }
    if (local_idx == 0) {
      let sum_final = ${Zt("workgroup_shared[0][0]",u)} / f32(hight * ${u});
      let squared_sum_final = ${Zt("workgroup_shared[0][1]",u)} / f32(hight * ${u});

      let inv_std_dev = inverseSqrt(squared_sum_final - sum_final * sum_final + f32(${s}));
      let channel_scale = inv_std_dev * f32(scale[channel]);
      let channel_shift = f32(bias[channel]) - sum_final * channel_scale;
      output[workgroup_index] = vec2f(channel_scale, channel_shift);
    }
  }`};return r.compute({name:"InstanceNormComputeChannelScaleShift",shaderCache:{hint:`${u};${s};${h}`,inputDependencies:_},getRunData:()=>({outputs:[{dims:b,dataType:1}],dispatchGroup:{x:p},programUniforms:S}),getShaderSource:v},{inputs:[e,n,t],outputs:[-1]})[0]},xC=(r,e,n)=>{let t=e[0].dims,o=t,i=2,a=t[0],s=t[1],u=k.sizeFromDimension(t,i),l=Ce(u),d=k.size(o)/l,p=$v(r,e[0],e[1],e[2],a,u,s,n.epsilon),h=[a,s,u/l],g=[a,s],b=["type","none"],_=S=>{let v=M("x",e[0].dataType,h.length,l),x=M("scale_shift",1,g.length,2),$=H("output",e[0].dataType,h.length,l),O=[v,x,$];return`
  ${S.registerUniform("output_size","u32").declareVariables(...O)}
  ${S.mainStart()}
  ${S.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
      let outputIndices = ${$.offsetToIndices("global_idx")};
      let batch = outputIndices[0];
      let channel = outputIndices[1];
      let scale_shift = ${x.getByIndices("vec2<u32>(batch, channel)")};
      let value = ${v.getByOffset("global_idx")} * ${$.type.value}(scale_shift.x) + ${$.type.value}(scale_shift.y);
      ${$.setByOffset("global_idx","value")};
  }`};r.compute({name:"InstanceNormalization",shaderCache:{hint:`${l}`,inputDependencies:b},getRunData:()=>({outputs:[{dims:o,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(d/64)},programUniforms:[{type:12,data:d},...K(h,g,h)]}),getShaderSource:_},{inputs:[e[0],p]})},TC=(r,e,n)=>{let t=e[0].dims,o=t,i=t[0],a=t[t.length-1],s=k.sizeFromDimension(t,1)/a,u=Ce(a),l=k.size(o)/u,d=[{type:12,data:s},{type:12,data:Math.floor(a/u)}],p=["type","type"],h=!1,g=[0,t.length-1];for(let v=0;v<t.length-2;v++)h=h||t[v+1]!==1,g.push(v+1);h=h&&t[t.length-1]!==1;let b=h?r.compute(ct(r.inputs[0],g),{inputs:[r.inputs[0]],outputs:[-1]})[0]:r.inputs[0].reshape(Array.from({length:t.length},(v,x)=>t[g[x]])),_=$v(r,b,e[1],e[2],i,s,a,n.epsilon),S=v=>{let x=Ue(e[0].dataType),$=u===1?"vec2f":`mat${u}x2f`,O=B=>{let T=B===0?"x":"y",F=u===1?"f32":`vec${u}f`;switch(u){case 1:return`${x}(${F}(scale.${T}))`;case 2:return`vec2<${x}>(${F}(scale[0].${T}, scale[1].${T}))`;case 4:return`vec4<${x}>(${F}(scale[0].${T}, scale[1].${T}, scale[2].${T}, scale[3].${T}))`;default:throw new Error(`Not supported compoents ${u}`)}},E=M("input",e[0].dataType,e[0].dims,u),D=H("output",e[0].dataType,o,u);return`
  @group(0) @binding(0) var<storage, read> input : array<${E.type.storage}>;
  @group(0) @binding(1) var<storage, read> scale_input : array<${$}>;
  @group(0) @binding(2) var<storage, read_write> output : array<${D.type.storage}>;
  struct Uniforms {H: u32, C : u32};
  @group(0) @binding(3) var<uniform> uniforms: Uniforms;

  ${v.mainStart()}
    let current_image_number = global_idx / (uniforms.C * uniforms.H);
    let current_channel_number = global_idx % uniforms.C;

    let scale_offset = current_image_number * uniforms.C + current_channel_number;
    let scale = scale_input[scale_offset];
    output[global_idx] = fma(input[global_idx], ${O(0)}, ${O(1)});
  }`};r.compute({name:"InstanceNormalizationNHWC",shaderCache:{hint:`${u}`,inputDependencies:p},getRunData:()=>({outputs:[{dims:o,dataType:e[0].dataType}],dispatchGroup:{x:Math.ceil(l/64)},programUniforms:d}),getShaderSource:S},{inputs:[e[0],_]})},Av=(r,e)=>{e.format==="NHWC"?TC(r,r.inputs,e):xC(r,r.inputs,e)}});var IC,SC,Pv,Ev=L(()=>{"use strict";ce();me();be();IC=r=>{if(!r||r.length<2)throw new Error("layerNorm requires at least 2 inputs.")},SC=(r,e,n)=>{let t=e.simplified,o=r[0].dims,i=r[1],a=!t&&r[2],s=o,u=k.normalizeAxis(e.axis,o.length),l=k.sizeToDimension(o,u),d=k.sizeFromDimension(o,u),p=k.size(i.dims),h=a?k.size(a.dims):0;if(p!==d||a&&h!==d)throw new Error(`Size of X.shape()[axis:] == ${d}.
       Size of scale and bias (if provided) must match this.
       Got scale size of ${p} and bias size of ${h}`);let g=[];for(let E=0;E<o.length;++E)E<u?g.push(o[E]):g.push(1);let b=Ce(d),_=["type","type"],S=[{type:12,data:l},{type:1,data:d},{type:12,data:Math.floor(d/b)},{type:1,data:e.epsilon}];a&&_.push("type");let v=n>1,x=n>2,$=E=>{let D=Ue(r[0].dataType),B=[M("x",r[0].dataType,r[0].dims,b),M("scale",i.dataType,i.dims,b)];a&&B.push(M("bias",a.dataType,a.dims,b)),B.push(H("output",r[0].dataType,s,b)),v&&B.push(H("mean_data_output",1,g)),x&&B.push(H("inv_std_output",1,g));let T=[{name:"norm_count",type:"u32"},{name:"norm_size",type:"f32"},{name:"norm_size_vectorized",type:"u32"},{name:"epsilon",type:"f32"}];return`
  ${E.registerUniforms(T).declareVariables(...B)}
  ${E.mainStart()}
    ${E.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.norm_count")}
    let offset = global_idx * uniforms.norm_size_vectorized;
    var mean_vector = ${$c("f32",b)};
    var mean_square_vector = ${$c("f32",b)};

    for (var h: u32 = 0u; h < uniforms.norm_size_vectorized; h++) {
      let value = ${Ur(D,b,"x[h + offset]")};
      mean_vector += value;
      mean_square_vector += value * value;
    }
    let mean = ${Zt("mean_vector",b)} / uniforms.norm_size;
    let inv_std_dev = inverseSqrt(${Zt("mean_square_vector",b)} / uniforms.norm_size ${t?"":"- mean * mean"} + uniforms.epsilon);

    for (var j: u32 = 0; j < uniforms.norm_size_vectorized; j++) {
      let f32input = ${Ur(D,b,"x[j + offset]")};
      let f32scale = ${Ur(D,b,"scale[j]")};
      output[j + offset] = ${B[0].type.value}((f32input ${t?"":"- mean"}) * inv_std_dev * f32scale
        ${a?`+ ${Ur(D,b,"bias[j]")}`:""}
      );
    }

    ${v?"mean_data_output[global_idx] = mean":""};
    ${x?"inv_std_output[global_idx] = inv_std_dev":""};
  }`},O=[{dims:s,dataType:r[0].dataType}];return v&&O.push({dims:g,dataType:1}),x&&O.push({dims:g,dataType:1}),{name:"LayerNormalization",shaderCache:{hint:`${b};${n};${t}`,inputDependencies:_},getRunData:()=>({outputs:O,dispatchGroup:{x:Math.ceil(l/64)},programUniforms:S}),getShaderSource:$}},Pv=(r,e)=>{IC(r.inputs),r.compute(SC(r.inputs,e,r.outputCount))}});var $C,Cv,Dv=L(()=>{"use strict";me();Za();Ja();$C=r=>{if(!r||r.length!==2)throw new Error("MatMul requires 2 inputs.");if(r[0].dims[r[0].dims.length-1]!==r[1].dims[r[1].dims.length-2])throw new Error("shared dimension does not match.")},Cv=r=>{$C(r.inputs);let e=Fn.calcShape(r.inputs[0].dims,r.inputs[1].dims,!0);if(!e)throw new Error("Can't use matmul on the given tensors");let n=e[e.length-1],t=r.inputs[0].dims[r.inputs[0].dims.length-1];if(n<8&&t<8)r.compute(Xa(r.inputs,{activation:""},e));else{let o=e[e.length-2],i=k.size(r.inputs[0].dims.slice(0,-2)),a=k.size(r.inputs[1].dims.slice(0,-2));if(i!==1&&o===1&&a===1){let s=r.inputs[0].reshape([1,i,t]),u=r.inputs[1].reshape([1,t,n]),l=[1,i,n],d=[s,u];r.compute(jo(d,{activation:""},e,l),{inputs:d})}else r.compute(jo(r.inputs,{activation:""},e))}}});var AC,OC,PC,kv,Nv,Lv=L(()=>{"use strict";ce();me();et();be();AC=(r,e)=>{if(r.length<3||r.length>4)throw new Error("MatMulNBits requires 3 or 4 inputs");let n=r[0],t=n.dims.length;if(n.dims[t-1]!==e.k)throw new Error("The last dim of input shape does not match the k value");let o=Math.floor((e.k+e.blockSize-1)/e.blockSize),i=e.blockSize/8*e.bits,a=r[1];if(!k.areEqual(a.dims,[e.n,o,i]))throw new Error("The second inputs must be 3D tensor with shape N X nBlocksPerCol X blobSize");let u=r[2].dims;if(k.size(u)!==e.n*o)throw new Error("scales input size error.");if(r.length===4){let d=r[3].dims,p=e.n*(e.bits===8?o:Math.floor((o*e.bits+7)/8));if(k.size(d)!==p)throw new Error("zeroPoints input size error.")}},OC=(r,e)=>{let n=r[0].dims,t=n.length,o=n[t-2],i=e.k,a=e.n,s=n.slice(0,t-2),u=k.size(s),d=r[1].dims[2]/4,p=r[0].dataType,h=Ce(e.k),g=Ce(d),b=Ce(a),_=s.concat([o,a]),S=o>1&&a/b%2===0?2:1,v=k.size(_)/b/S,x=64,$=[],O=[u,o,i/h],E=k.convertShape(r[1].dims).slice();E.splice(-1,1,d/g),$.push(...K(O)),$.push(...K(E)),$.push(...K(r[2].dims)),r.length===4&&$.push(...K(k.convertShape(r[3].dims)));let D=[u,o,a/b];$.push(...K(D));let B=T=>{let F=O.length,W=M("a",r[0].dataType,F,h),z=M("b",12,E.length,g),te=M("scales",r[2].dataType,r[2].dims.length),V=[W,z,te],w=r.length===4?M("zero_points",12,r[3].dims.length):void 0;w&&V.push(w);let R=D.length,j=H("output",r[0].dataType,R,b),J=Ue(r[0].dataType),Z=(()=>{switch(h){case 1:return`array<${J}, 8>`;case 2:return`mat4x2<${J}>`;case 4:return`mat2x4<${J}>`;default:throw new Error(`${h}-component is not supported.`)}})(),oe=Math.floor(32/e.bits),se=Math.floor(oe/8),pe=()=>{let U="";for(let q=0;q<se;q++){let ye=q*e.bits*4,Je=ye+e.bits;U+=`
          // reuse a data (pass ${q})
            var input_offset${q>0?q:""} = ${q===0?W.indicesToOffset(`${W.type.indices}(batch, row, word_offset)`):"input_offset"};
            var a_data${q>0?q:""}: ${Z};
            for (var j${q>0?q:""}: u32 = 0; j${q>0?q:""} < ${8/h}; j${q>0?q:""}++) {
              a_data${q>0?q:""}[j${q>0?q:""}] = ${W.getByOffset(`input_offset${q>0?q:""}`)};
              input_offset${q>0?q:""}++;
            }
          `;for(let Fe=0;Fe<b*S;Fe++)U+=`
            b_value = ${g===1?`b${Fe}_data`:`b${Fe}_data[i]`};
            ${e.bits===2?`{
              let half_word = b_value >> ${q*16}u;
              let byte_lo = half_word & 0xFFu;
              let byte_hi = (half_word >> 8u) & 0xFFu;
              let spread_word = (byte_lo & 0xFu) | ((byte_lo >> 4u) << 8u) | ((byte_hi & 0xFu) << 16u) | ((byte_hi >> 4u) << 24u);
              b_value_lower = unpack4xU8(spread_word & b_mask);
              b_value_upper = unpack4xU8((spread_word >> 2u) & b_mask);
            }`:`b_value_lower = unpack4xU8((b_value >> ${ye}u) & b_mask);
            b_value_upper = unpack4xU8((b_value >> ${Je}u) & b_mask);`}
            b_quantized_values = ${Z}(${Array.from({length:4},(st,ke)=>`${J}(b_value_lower[${ke}]), ${J}(b_value_upper[${ke}])`).join(", ")});
            b_dequantized_values = ${h===1?`${Z}(${Array.from({length:8},(st,ke)=>`(b_quantized_values[${ke}] - ${w?`zero_point${Fe}`:"zero_point"}) * scale${Fe}`).join(", ")});`:`(b_quantized_values - ${Z}(${Array(8).fill(`${w?`zero_point${Fe}`:"zero_point"}`).join(",")})) * scale${Fe};`};
            workgroup_shared[local_id.x * ${S} + ${Math.floor(Fe/b)}]${b>1?`[${Fe%b}]`:""} += ${Array.from({length:8/h},(st,ke)=>`${h===1?`a_data${q>0?q:""}[${ke}] * b_dequantized_values[${ke}]`:`dot(a_data${q>0?q:""}[${ke}], b_dequantized_values[${ke}])`}`).join(" + ")};
          `}return U},De=()=>{let U=`
            var col_index = col * ${b};
            ${w?`
            let zero_point_values_per_byte: u32 = ${Math.floor(8/e.bits)}u;
            let zero_point_bytes_per_col = (nBlocksPerCol + zero_point_values_per_byte - 1u) / zero_point_values_per_byte;
            var zero_point_byte_count: u32;
            var zero_point_word_index: u32;
            var zero_point_byte_offset: u32;
            let zero_point_sub_offset: u32 = block % zero_point_values_per_byte;
            var zero_point_bits_offset: u32;
            var zero_point_word: u32;`:`
            // The default zero point is ${Math.pow(2,e.bits-1)} for unsigned ${e.bits}-bit quantization.
            let zero_point = ${J}(${Math.pow(2,e.bits-1).toFixed(1)});`}
            `;for(let q=0;q<b*S;q++)U+=`
            let scale${q} = ${te.getByOffset("col_index * nBlocksPerCol + block")};
            ${w?`
            zero_point_byte_count = col_index * zero_point_bytes_per_col + (block / zero_point_values_per_byte);
            zero_point_word_index = zero_point_byte_count >> 0x2u;
            zero_point_byte_offset = zero_point_byte_count & 0x3u;
            zero_point_bits_offset = (zero_point_byte_offset << 3) + (zero_point_sub_offset * ${e.bits}u);
            zero_point_word = ${w.getByOffset("zero_point_word_index")} >> zero_point_bits_offset;
            let zero_point${q} = ${J}((zero_point_word) & ${e.bits===2?"0x3u":"0xFu"});`:""}
            col_index += 1;`;return U},fe=()=>{let U=`col_index = col * ${b};`;for(let q=0;q<b*S;q++)U+=`
            let b${q}_data = ${z.getByIndices(`${z.type.indices}(col_index, block, word)`)};
            col_index += 1;`;return U+=`
            var b_value: u32;
            let b_mask: u32 = ${e.bits===2?"0x03030303u":"0x0F0F0F0Fu"};
            var b_value_lower: vec4<u32>;
            var b_value_upper: vec4<u32>;
            var b_quantized_values: ${Z};
            var b_dequantized_values: ${Z};`,U};return`
        var<workgroup> workgroup_shared: array<${j.type.value}, ${S*x}>;
        ${T.declareVariables(...V,j)}
        ${T.mainStart([x,1,1])}
          let output_indices = ${j.offsetToIndices(`(global_idx / ${x}) * ${S}`)};
          let col = output_indices[2];
          let row = output_indices[1];
          let batch = output_indices[0];
          let nBlocksPerCol = uniforms.b_shape[1];

          for (var block = local_id.x; block < nBlocksPerCol; block += ${x}) {
            //process one block
            var word_offset: u32 = block * ${e.blockSize/h};
            ${De()}
            for (var word: u32 = 0; word < ${d}; word += ${g}) {
              ${fe()}
              for (var i: u32 = 0; i < ${g}; i++) {
                ${pe()}
                word_offset += ${oe/h};
              }
            }
          }
          workgroupBarrier();

          if (local_id.x < ${S}) {
            var output_value: ${j.type.value} = ${j.type.value}(0);
            var workgroup_shared_offset: u32 = local_id.x;
            for (var b: u32 = 0u; b < ${x}u; b++) {
              output_value += workgroup_shared[workgroup_shared_offset];
              workgroup_shared_offset += ${S};
            }
            ${j.setByIndices(`${j.type.indices}(batch, row, col + local_id.x)`,"output_value")};
          }
        }`};return{name:"MatMulNBits",shaderCache:{hint:`${e.blockSize};${e.bits};${h};${g};${b};${S};${x}`,inputDependencies:Array(r.length).fill("rank")},getRunData:()=>({outputs:[{dims:_,dataType:p}],dispatchGroup:{x:v},programUniforms:$}),getShaderSource:B}},PC=(r,e)=>{let n=r[0].dims,t=n.length,o=n[t-2],i=e.k,a=e.n,s=n.slice(0,t-2),u=k.size(s),d=r[1].dims[2]/4,p=r[0].dataType,h=Ce(e.k),g=Ce(d),b=s.concat([o,a]),_=128,S=a%8===0?8:a%4===0?4:1,v=_/S,x=Math.floor(32/e.bits),$=v*g*x,O=$/h,E=$/e.blockSize,D=k.size(b)/S,B=[],T=[u,o,i/h],F=k.convertShape(r[1].dims).slice();F.splice(-1,1,d/g),B.push(...K(T)),B.push(...K(F)),B.push(...K(r[2].dims)),r.length===4&&B.push(...K(k.convertShape(r[3].dims)));let W=[u,o,a];B.push(...K(W));let z=te=>{let V=T.length,w=M("a",r[0].dataType,V,h),R=M("b",12,F.length,g),j=M("scales",r[2].dataType,r[2].dims.length),J=[w,R,j],Z=r.length===4?M("zero_points",12,r[3].dims.length):void 0;Z&&J.push(Z);let oe=W.length,se=H("output",r[0].dataType,oe),pe=Ue(r[0].dataType),De=()=>{switch(h){case 1:return`
          let a_data0 = vec4<${pe}>(sub_a[word_offset], sub_a[word_offset + 1], sub_a[word_offset + 2], sub_a[word_offset + 3]);
          let a_data1 = vec4<${pe}>(sub_a[word_offset + 4], sub_a[word_offset + 5], sub_a[word_offset + 6], sub_a[word_offset + 7]);`;case 2:return`
          let a_data0 = vec4<${pe}>(sub_a[word_offset], sub_a[word_offset + 1]);
          let a_data1 = vec4<${pe}>(sub_a[word_offset + 2], sub_a[word_offset + 3]);`;case 4:return`
          let a_data0 = sub_a[word_offset];
          let a_data1 = sub_a[word_offset + 1];`;default:throw new Error(`${h}-component is not supported.`)}};return`
        var<workgroup> sub_a: array<${w.type.value}, ${O}>;
        var<workgroup> inter_results: array<array<${se.type.value}, ${v}>, ${S}>;
        ${te.declareVariables(...J,se)}
        ${te.mainStart([v,S,1])}
          let output_indices = ${se.offsetToIndices(`workgroup_index * ${S}`)};
          let col = output_indices[2];
          let row = output_indices[1];
          let batch = output_indices[0];
          let n_blocks_per_col = uniforms.b_shape[1];
          let num_tiles =  (n_blocks_per_col - 1) / ${E} + 1;

          // Loop over shared dimension.
          for (var tile: u32 = 0; tile < num_tiles; tile += 1) {
            let a_col_start = tile * ${O};
            // load one tile A data into shared memory.
            for (var a_offset = local_idx; a_offset < ${O}; a_offset += ${_})
            {
              let a_col = a_col_start + a_offset;
              if (a_col < uniforms.a_shape[2])
              {
                sub_a[a_offset] = ${w.getByIndices(`${w.type.indices}(batch, row, a_col)`)};
              } else {
                sub_a[a_offset] = ${w.type.value}(0);
              }
            }
            workgroupBarrier();

            // each thread process one block
            let b_row = col + local_id.y;
            let block = tile * ${E} + local_id.x;
            ${Z?`
            let zero_point_values_per_byte: u32 = ${Math.floor(8/e.bits)}u;
            let zero_point_bytes_per_col = (n_blocks_per_col + zero_point_values_per_byte - 1u) / zero_point_values_per_byte;
            let zero_point_byte_count = b_row * zero_point_bytes_per_col + (block / zero_point_values_per_byte);
            let zero_point_word_index = zero_point_byte_count >> 0x2u;
            let zero_point_byte_offset = zero_point_byte_count & 0x3u;
            let zero_point_sub_offset: u32 = block % zero_point_values_per_byte;
            let zero_point_bits_offset = (zero_point_byte_offset << 3) + (zero_point_sub_offset * ${e.bits}u);
            let zero_point_word = ${Z.getByOffset("zero_point_word_index")} >> zero_point_bits_offset;
            let zero_point = ${pe}((zero_point_word) & ${e.bits===2?"0x3u":"0xFu"});`:`
            // The default zero point is ${Math.pow(2,e.bits-1)} for unsigned ${e.bits}-bit quantization.
            let zero_point = ${pe}(${Math.pow(2,e.bits-1).toFixed(1)});`}
            let scale = ${j.getByOffset("b_row * n_blocks_per_col + block")};
            let b_data = ${R.getByIndices(`${R.type.indices}(b_row, block, 0)`)};
            var word_offset = local_id.x * ${e.blockSize/h};
            for (var i: u32 = 0; i < ${g}; i++) {
              let b_value = ${g===1?"b_data":"b_data[i]"};
              ${(()=>{let fe=Math.floor(x/8),U="";for(let q=0;q<fe;q++){let ye=q*e.bits*4,Je=ye+e.bits;U+=`
              ${De()}
              {${e.bits===2?`
                let half_word = b_value >> ${q*16}u;
                let byte_lo = half_word & 0xFFu;
                let byte_hi = (half_word >> 8u) & 0xFFu;
                let spread_word = (byte_lo & 0xFu) | ((byte_lo >> 4u) << 8u) | ((byte_hi & 0xFu) << 16u) | ((byte_hi >> 4u) << 24u);
                let b_value_lower = unpack4xU8(spread_word & 0x03030303u);
                let b_value_upper = unpack4xU8((spread_word >> 2u) & 0x03030303u);`:`
                let b_value_lower = unpack4xU8((b_value >> ${ye}u) & 0x0F0F0F0Fu);
                let b_value_upper = unpack4xU8((b_value >> ${Je}u) & 0x0F0F0F0Fu);`}
                let b_quantized_values = mat2x4<${pe}>(${Array.from({length:4},(Fe,st)=>`${pe}(b_value_lower[${st}]), ${pe}(b_value_upper[${st}])`).join(", ")});
                let b_dequantized_values = (b_quantized_values - mat2x4<${pe}>(${Array(8).fill("zero_point").join(",")})) * scale;
                inter_results[local_id.y][local_id.x] += ${Array.from({length:2},(Fe,st)=>`${`dot(a_data${st}, b_dequantized_values[${st}])`}`).join(" + ")};
              }
              word_offset += ${8/h};`}return U})()}
            }
            workgroupBarrier();
          }

          if (local_idx < ${S}) {
            var output_value: ${se.type.value} = ${se.type.value}(0);
            for (var b = 0u; b < ${v}; b++) {
              output_value += inter_results[local_idx][b];
            }
            if (col + local_idx < uniforms.output_shape[2])
            {
              ${se.setByIndices(`${se.type.indices}(batch, row, col + local_idx)`,"output_value")}
            }
          }
        }`};return{name:"BlockwiseMatMulNBits32",shaderCache:{hint:`${e.blockSize};${h};${g};${v};${S}`,inputDependencies:Array(r.length).fill("rank")},getRunData:()=>({outputs:[{dims:b,dataType:p}],dispatchGroup:{x:D},programUniforms:B}),getShaderSource:z}},kv=(r,e)=>{AC(r.inputs,e),e.blockSize===32&&r.adapterInfo.isVendor("intel")&&r.adapterInfo.isArchitecture("gen-12lp")?r.compute(PC(r.inputs,e)):r.compute(OC(r.inputs,e))},Nv=r=>de(r)});var EC,CC,DC,kC,NC,LC,RC,zC,Rv,zv=L(()=>{"use strict";ce();me();be();EC=r=>{if(!r||r.length<1)throw new Error("Too few inputs");if(r[0].dataType!==1&&r[0].dataType!==10)throw new Error("Input type must be float or float16.");if(r.length>=2){let e=r[0].dims.length*2===r[1].dims[0];if(r.length===4&&(e=r[3].dims[0]*2===r[1].dims[0]),!e)throw new Error("The pads should be a 1D tensor of shape [2 * input_rank] or [2 * num_axes].")}},CC=(r,e,n)=>{let t="";for(let o=e-1;o>=0;--o)t+=`
            k = i32(${r.indicesGet("indices",o)}) - ${re("uniforms.pads",o,n)};
            if (k < 0) {
              break;
            }
            if (k >= i32(${re("uniforms.x_shape",o,e)})) {
              break;
            }
            offset += k * i32(${re("uniforms.x_strides",o,e)});
        `;return`
          value = ${r.type.value}(uniforms.constant_value);
          for (var i = 0; i < 1; i++) {
            var offset = 0;
            var k = 0;
            ${t}
            value = x[offset];
          }
      `},DC=(r,e,n)=>{let t="";for(let o=e-1;o>=0;--o)t+=`
                k = i32(${r.indicesGet("indices",o)}) - ${re("uniforms.pads",o,n)};
                if (k < 0) {
                  k = -k;
                }
                {
                  let _2n_1 = 2 * (i32(${re("uniforms.x_shape",o,e)}) - 1);
                  k = k % _2n_1;
                  if(k >= i32(${re("uniforms.x_shape",o,e)})) {
                    k = _2n_1 - k;
                  }
                }
                offset += k * i32(${re("uniforms.x_strides",o,e)});
            `;return`
              var offset = 0;
              var k = 0;
              ${t}
              value = x[offset];
          `},kC=(r,e,n)=>{let t="";for(let o=e-1;o>=0;--o)t+=`
                k = i32(${r.indicesGet("indices",o)}) - ${re("uniforms.pads",o,n)};
                if (k < 0) {
                  k = 0;
                }
                if (k >= i32(${re("uniforms.x_shape",o,e)})) {
                  k = i32(${re("uniforms.x_shape",o,e)}) - 1;
                }
                offset += k * i32(${re("uniforms.x_strides",o,e)});
            `;return`
              var offset = 0;
              var k = 0;
              ${t}
              value = x[offset];
          `},NC=(r,e,n)=>{let t="";for(let o=e-1;o>=0;--o)t+=`
                k = i32(${r.indicesGet("indices",o)}) - ${re("uniforms.pads",o,n)};
                if (k < 0)  {
                  k += i32(${re("uniforms.x_shape",o,e)}]);
                }
                if (k >= i32(${re("uniforms.x_shape",o,e)})) {
                  k -= i32(${re("uniforms.x_shape",o,e)});
                }
                offset += k * i32(${re("uniforms.x_strides",o,e)});
            `;return`
              var offset = 0;
              var k = 0;
              ${t}
              value = x[offset];
          `},LC=(r,e,n)=>{switch(n.mode){case 0:return CC(r,e,n.pads.length);case 1:return DC(r,e,n.pads.length);case 2:return kC(r,e,n.pads.length);case 3:return NC(r,e,n.pads.length);default:throw new Error("Invalid mode")}},RC=(r,e)=>{let n=k.padShape(r[0].dims.slice(),e.pads),t=r[0].dims,o=k.size(n),i=[{type:12,data:o},{type:6,data:e.pads}],a=r.length>=3&&r[2].data;e.mode===0&&i.push({type:a?r[2].dataType:1,data:e.value}),i.push(...K(r[0].dims,n));let s=["rank"],u=l=>{let d=H("output",r[0].dataType,n.length),p=M("x",r[0].dataType,t.length),h=p.type.value,g=LC(d,t.length,e),b=[{name:"output_size",type:"u32"},{name:"pads",type:"i32",length:e.pads.length}];return e.mode===0&&b.push({name:"constant_value",type:a?h:"f32"}),`
            ${l.registerUniforms(b).declareVariables(p,d)}
            ${l.mainStart()}
            ${l.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}

            let indices = ${d.offsetToIndices("global_idx")};

            var value = ${h}(0);
            ${g}
            output[global_idx] = value;
        }`};return{name:"Pad",shaderCache:{hint:`${e.mode}${a}`,inputDependencies:s},getRunData:()=>({outputs:[{dims:n,dataType:r[0].dataType}],dispatchGroup:{x:Math.ceil(k.size(n)/64)},programUniforms:i}),getShaderSource:u}},zC=(r,e)=>{if(r.length>1){let n=r[1].getBigInt64Array(),t=r.length>=3&&r[2].data?r[2].dataType===10?r[2].getUint16Array()[0]:r[2].getFloat32Array()[0]:0,o=r[0].dims.length,i=new Int32Array(2*o).fill(0);if(r.length>=4){let s=r[3].getBigInt64Array();for(let u=0;u<s.length;u++)i[Number(s[u])]=Number(n[u]),i[Number(s[u])+o]=Number(n[u+s.length])}else n.forEach((s,u)=>i[Number(u)]=Number(s));let a=[];return i.forEach(s=>a.push(s)),{mode:e.mode,value:t,pads:a}}else return e},Rv=(r,e)=>{EC(r.inputs);let n=zC(r.inputs,e);r.compute(RC(r.inputs,n),{inputs:[0]})}});var ts,Mv,Bv,Vv,Gv,MC,BC,Uv,Fv,Wv,Hv,qv,jv,Kv,Xv,Zv,Jv,Yv,Qv,ex=L(()=>{"use strict";ht();ce();me();be();ts=r=>{if(he.webgpu.validateInputContent&&(!r||r.length!==1))throw new Error("Pool ops requires 1 input.")},Mv=(r,e,n)=>{let t=e.format==="NHWC",o=r.dims.slice();t&&o.splice(1,0,o.pop());let i=Object.hasOwnProperty.call(e,"dilations"),a=e.kernelShape.slice(),s=e.strides.slice(),u=i?e.dilations.slice():[],l=e.pads.slice();Vr.adjustPoolAttributes(n,o,a,s,u,l);let d=Vr.computePoolOutputShape(n,o,s,u,a,l,e.autoPad),p=Object.assign({},e);i?Object.assign(p,{kernelShape:a,strides:s,pads:l,dilations:u,cacheKey:e.cacheKey}):Object.assign(p,{kernelShape:a,strides:s,pads:l,cacheKey:e.cacheKey});let h=d.slice();return h.push(h.splice(1,1)[0]),[p,t?h:d]},Bv=(r,e)=>{let n=e.format==="NHWC",t=k.size(r),o=k.size(e.kernelShape),i=[{type:12,data:t},{type:12,data:o}],a=[{name:"outputSize",type:"u32"},{name:"kernelSize",type:"u32"}];if(e.kernelShape.length<=2){let s=e.kernelShape[e.kernelShape.length-1],u=e.strides[e.strides.length-1],l=e.pads[e.pads.length/2-1],d=e.pads[e.pads.length-1],p=!!(l+d);i.push({type:12,data:s},{type:12,data:u},{type:12,data:l},{type:12,data:d}),a.push({name:"kw",type:"u32"},{name:"sw",type:"u32"},{name:"pwStart",type:"u32"},{name:"pwEnd",type:"u32"});let h=!1;if(e.kernelShape.length===2){let g=e.kernelShape[e.kernelShape.length-2],b=e.strides[e.strides.length-2],_=e.pads[e.pads.length/2-2],S=e.pads[e.pads.length-2];h=!!(_+S),i.push({type:12,data:g},{type:12,data:b},{type:12,data:_},{type:12,data:S}),a.push({name:"kh",type:"u32"},{name:"sh",type:"u32"},{name:"phStart",type:"u32"},{name:"phEnd",type:"u32"})}return[i,a,!0,p,h]}else{if(n)throw new Error("Pooling with kernelShape.length > 2 is not supported for NHWC format.");let s=k.computeStrides(e.kernelShape);i.push({type:12,data:s},{type:12,data:e.pads},{type:12,data:e.strides}),a.push({name:"kernelStrides",type:"u32",length:s.length},{name:"pads",type:"u32",length:e.pads.length},{name:"strides",type:"u32",length:e.strides.length});let u=e.pads.reduce((l,d)=>l+d);return[i,a,!!u,!1,!1]}},Vv=(r,e,n,t,o,i,a,s,u,l,d,p)=>{let h=o.format==="NHWC",g=e.type.value,b=H("output",e.type.tensor,t);if(o.kernelShape.length<=2){let _="",S="",v="",x=n-(h?2:1);if(d?_=`
                for (var i: u32 = 0u; i < uniforms.kw; i++) {
                  xIndices[${x}] = indices[${x}] * uniforms.sw - uniforms.pwStart + i;
                  if (xIndices[${x}] < 0 || xIndices[${x}]
                      >= uniforms.x_shape[${x}]) {
                    pad++;
                    continue;
                  }
                  let x_val = x[${e.indicesToOffset("xIndices")}];
                  ${i}
                }`:_=`
                for (var i: u32 = 0u; i < uniforms.kw; i++) {
                  xIndices[${x}] = indices[${x}] * uniforms.sw - uniforms.pwStart + i;
                  let x_val = x[${e.indicesToOffset("xIndices")}];
                  ${i}
                }`,o.kernelShape.length===2){let O=n-(h?3:2);p?S=`
                for (var j: u32 = 0u; j < uniforms.kh; j++) {
                  xIndices[${O}] = indices[${O}] * uniforms.sh - uniforms.phStart + j;
                  if (xIndices[${O}] < 0 || xIndices[${O}] >= uniforms.x_shape[${O}]) {
                    pad += i32(uniforms.kw);
                    continue;
                  }
              `:S=`
                for (var j: u32 = 0u; j < uniforms.kh; j++) {
                  xIndices[${O}] = indices[${O}] * uniforms.sh - uniforms.phStart + j;
                `,v=`
              }
            `}return`
            ${r.registerUniforms(u).declareVariables(e,b)}

            ${r.mainStart()}
              ${r.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}

              let indices = ${b.offsetToIndices("global_idx")};
              var xIndices = ${b.offsetToIndices("global_idx")};

              var value = ${g}(${s});
              var pad = 0;
              ${S}
              ${_}
              ${v}
              ${a}

              output[global_idx] = value;
            }`}else{if(h)throw new Error("Pooling with kernelShape.length > 2 is not supported for NHWC format.");let _=o.kernelShape.length,S=o.pads.length,v="";return l?v=`
                if (xIndices[j] >= uniforms.x_shape[j]) {
                  pad++;
                  isPad = true;
                  break;
                }
              }
              if (!isPad) {
                let x_val = x[${e.indicesToOffset("xIndices")}];
                ${i}
              }`:v=`
              }
              let x_val = x[${e.indicesToOffset("xIndices")}];
              ${i}
            `,`
            ${r.registerUniforms(u).declareVariables(e,b)}

            ${r.mainStart()}
              ${r.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
              let indices = ${b.offsetToIndices("global_idx")};
              var xIndices = ${b.offsetToIndices("global_idx")};

              var offsets: array<u32, ${_}>;

              var value = ${g}(${s});
              var pad = 0;
              var isPad = false;

              for (var i: u32 = 0u; i < uniforms.kernelSize; i++) {
                var offset = i;
                for (var j = 0u; j < ${_-1}u; j++) {
                  offsets[j] = offset / ${re("uniforms.kernelStrides","j",_)};
                  offset -= offsets[j] * ${re("uniforms.kernelStrides","j",_)};
                }
                offsets[${_-1}] = offset;

                isPad = false;
                for (var j = ${n-_}u; j < ${n}u; j++) {
                  xIndices[j] = indices[j] * ${re("uniforms.strides",`j - ${n-_}u`,_)}
                    + offsets[j - ${n-_}u] - ${re("uniforms.pads","j - 2u",S)};
                  ${v}
              }
              ${a}

              output[global_idx] = value;
            }`}},Gv=r=>`${r.format};${r.ceilMode};${r.autoPad};${r.kernelShape.length}`,MC=r=>`${Gv(r)};${r.countIncludePad}`,BC=r=>`${Gv(r)};${r.storageOrder};${r.dilations}`,Uv=r=>({format:r.format,autoPad:["NOTSET","VALID","SAME_UPPER","SAME_LOWER"][r.auto_pad],ceilMode:r.ceil_mode,kernelShape:r.kernel_shape,strides:r.strides,pads:r.pads}),Fv=(r,e,n,t)=>{let[o,i]=Mv(e,t,n),a=M("x",e.dataType,e.dims.length),s=a.type.value,u="value += x_val;",l="";o.countIncludePad?l+=`value /= ${s}(uniforms.kernelSize);`:l+=`value /= ${s}(i32(uniforms.kernelSize) - pad);`;let[d,p,h,g,b]=Bv(i,o);d.push(...K(e.dims,i));let _=["rank"];return{name:r,shaderCache:{hint:`${t.cacheKey};${h};${g};${b}`,inputDependencies:_},getRunData:()=>({outputs:[{dims:i,dataType:e.dataType}],dispatchGroup:{x:Math.ceil(k.size(i)/64)},programUniforms:d}),getShaderSource:S=>Vv(S,a,e.dims.length,i.length,o,u,l,0,p,h,g,b)}},Wv=r=>{let e=r.count_include_pad!==0,n=Uv(r);if(n.ceilMode!==0)throw new Error("using ceil() in shape computation is not yet supported for AveragePool");let t={countIncludePad:e,...n,cacheKey:""};return{...t,cacheKey:MC(t)}},Hv=(r,e)=>{ts(r.inputs),r.compute(Fv("AveragePool",r.inputs[0],!1,e))},qv={autoPad:"",ceilMode:0,countIncludePad:!1,kernelShape:[],strides:[],pads:[],storageOrder:0,dilations:[]},jv=r=>{let e=r.format;return{format:e,...qv,cacheKey:e}},Kv=(r,e)=>{ts(r.inputs),r.compute(Fv("GlobalAveragePool",r.inputs[0],!0,e))},Xv=(r,e,n,t)=>{let[o,i]=Mv(e,t,n),a=`
      value = max(x_val, value);
    `,s="",u=M("x",e.dataType,e.dims.length),l=["rank"],[d,p,h,g,b]=Bv(i,o);return d.push(...K(e.dims,i)),{name:r,shaderCache:{hint:`${t.cacheKey};${h};${g};${b}`,inputDependencies:l},getRunData:()=>({outputs:[{dims:i,dataType:e.dataType}],dispatchGroup:{x:Math.ceil(k.size(i)/64)},programUniforms:d}),getShaderSource:_=>Vv(_,u,e.dims.length,i.length,o,a,s,e.dataType===10?-65504:-1e5,p,h,g,b)}},Zv=(r,e)=>{ts(r.inputs),r.compute(Xv("MaxPool",r.inputs[0],!1,e))},Jv=r=>{let e=r.storage_order,n=r.dilations,t=Uv(r);if(e!==0)throw new Error("column major storage order is not yet supported for MaxPool");if(t.ceilMode!==0)throw new Error("using ceil() in shape computation is not yet supported for MaxPool");let o={storageOrder:e,dilations:n,...t,cacheKey:""};return{...o,cacheKey:BC(o)}},Yv=r=>{let e=r.format;return{format:e,...qv,cacheKey:e}},Qv=(r,e)=>{ts(r.inputs),r.compute(Xv("GlobalMaxPool",r.inputs[0],!0,e))}});var GC,UC,tx,nx,rx=L(()=>{"use strict";ce();me();et();be();GC=(r,e)=>{if(r.length<2||r.length>3)throw new Error("DequantizeLinear requires 2 or 3 inputs.");if(r.length===3&&r[1].dims===r[2].dims)throw new Error("x-scale and x-zero-point must have the same shape.");if(r.length===3&&r[0].dataType!==r[2].dataType)throw new Error("x and x-zero-point must have the same data type.");if(r[1].dims.length!==0&&r[1].dims.length!==1&&r[1].dims.length!==r[0].dims.length)throw new Error("scale input must be a scalar, a 1D tensor, or have the same rank as the input tensor.");if(r.length>2){if(r[0].dataType!==r[2].dataType)throw new Error("x and x-zero-point must have the same data type.");if(r[1].dims.length!==r[2].dims.length)throw new Error("scale and zero-point inputs must have the same rank.");if(!r[1].dims.map((n,t)=>n===r[2].dims[t]).reduce((n,t)=>n&&t,!0))throw new Error("scale and zero-point inputs must have the same shape.")}if(e.blockSize>0){if(r[1].dims.length===0||r[1].dims.length===1&&r[1].dims[0]===1)throw new Error("blockSize must be set only for block quantization.");if(!r[1].dims.map((o,i)=>i===e.axis||o===r[0].dims[i]).reduce((o,i)=>o&&i,!0))throw new Error("For block qunatization, scale input shape to match the input shape except for the axis");if(r[1].dims.length!==r[0].dims.length)throw new Error("For block qunatization the scale input rank must be the same as the x rank.");let n=r[0].dims[e.axis],t=r[1].dims[e.axis];if(e.blockSize<Math.ceil(n/t)||e.blockSize>Math.ceil(n/(t-1)-1))throw new Error("blockSize must be with in the range [ceil(dI / Si), ceil(dI / (Si - 1) - 1)].")}},UC=(r,e)=>{let n=k.normalizeAxis(e.axis,r[0].dims.length),t=r[0].dataType,o=t===3,i=r[0].dims,a=r[1].dataType,s=k.size(i),u=t===3||t===2,l=u?[Math.ceil(k.size(r[0].dims)/4)]:r[0].dims,d=r[1].dims,p=r.length>2?r[2]:void 0,h=p?u?[Math.ceil(k.size(p.dims)/4)]:p.dims:void 0,g=d.length===0||d.length===1&&d[0]===1,b=g===!1&&d.length===1,_=Ce(s),S=g&&(!u||_===4),v=S?_:1,x=S&&!u?_:1,$=M("input",u?12:t,l.length,x),O=M("scale",a,d.length),E=p?M("zero_point",u?12:t,h.length):void 0,D=H("output",a,i.length,v),B=[$,O];E&&B.push(E);let T=[l,d];p&&T.push(h);let F=[{type:12,data:s/v},{type:12,data:n},{type:12,data:e.blockSize},...K(...T,i)],W=z=>{let te=[{name:"output_size",type:"u32"},{name:"axis",type:"u32"},{name:"block_size",type:"u32"}];return`
      ${z.registerUniforms(te).declareVariables(...B,D)}
      ${z.mainStart()}
          ${z.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
          let output_indices = ${D.offsetToIndices("global_idx")};

          // Set input x
          ${u?`
            let input = ${$.getByOffset("global_idx / 4")};
            let x_vec = ${o?"unpack4xI8(input)":"unpack4xU8(input)"};
            let x_value = ${v===1?"x_vec[global_idx % 4]":"x_vec"};`:`let x_value = ${$.getByOffset("global_idx")};`};

          // Set scale input
          ${g?`let scale_value= ${O.getByOffset("0")}`:b?`
            let scale_index = ${D.indicesGet("output_indices","uniforms.axis")};
            let scale_value= ${O.getByOffset("scale_index")};`:`
            var scale_indices: ${O.type.indices} = output_indices;
            let index = ${O.indicesGet("scale_indices","uniforms.axis")} / uniforms.block_size;
            ${O.indicesSet("scale_indices","uniforms.axis","index")};
            let scale_value= ${O.getByIndices("scale_indices")};`};

          // Set zero-point input
          ${E?g?u?`
                let zero_point_input = ${E.getByOffset("0")};
                let zero_point_vec =  ${o?"unpack4xI8(zero_point_input)":"unpack4xU8(zero_point_input)"};
                let zero_point_value= zero_point_vec[0]`:`let zero_point_value = ${E.getByOffset("0")}`:b?u?`
                let zero_point_index = ${D.indicesGet("output_indices","uniforms.axis")};
                let zero_point_input = ${E.getByOffset("zero_point_index / 4")};
                let zero_point_vec =  ${o?"unpack4xI8(zero_point_input)":"unpack4xU8(zero_point_input)"};
                let zero_point_value = zero_point_vec[zero_point_index % 4]`:`
                let zero_point_index = ${D.indicesGet("output_indices","uniforms.axis")};
                let zero_point_value = ${E.getByOffset("zero_point_index")};`:u?`
                let zero_point_offset = ${O.indicesToOffset("scale_indices")};
                let zero_point_input = ${E.getByOffset("zero_point_offset / 4")};
                let zero_point_vec = ${o?"unpack4xI8(zero_point_input)":"unpack4xU8(zero_point_input)"};
                let zero_point_value = zero_point_vec[zero_point_offset % 4];`:`let zero_point_value = ${E.getByIndices("scale_indices")};`:`let zero_point_value = ${u?o?"i32":"u32":$.type.value}(0);`};
      // Compute and write output
      ${D.setByOffset("global_idx",`${D.type.value}(x_value - zero_point_value) * scale_value`)};
      }`};return{name:"DequantizeLinear",shaderCache:{hint:e.cacheKey,inputDependencies:E?["rank","rank","rank"]:["rank","rank"]},getShaderSource:W,getRunData:()=>({outputs:[{dims:i,dataType:a}],dispatchGroup:{x:Math.ceil(s/v/64),y:1,z:1},programUniforms:F})}},tx=(r,e)=>{GC(r.inputs,e),r.compute(UC(r.inputs,e))},nx=r=>de({axis:r.axis,blockSize:r.blockSize})});var FC,WC,ox,ix=L(()=>{"use strict";ht();ce();be();FC=(r,e,n)=>{let t=r===e,o=r<e&&n<0,i=r>e&&n>0;if(t||o||i)throw new Error("Range these inputs' contents are invalid.")},WC=(r,e,n,t)=>{let o=Math.abs(Math.ceil((e-r)/n)),i=[o],a=o,s=[{type:12,data:a},{type:t,data:r},{type:t,data:n},...K(i)],u=l=>{let d=H("output",t,i.length),p=d.type.value,h=[{name:"outputSize",type:"u32"},{name:"start",type:p},{name:"delta",type:p}];return`
        ${l.registerUniforms(h).declareVariables(d)}
        ${l.mainStart()}
        ${l.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
        output[global_idx] = uniforms.start + ${p}(global_idx) * uniforms.delta;
      }`};return{name:"Range",shaderCache:{hint:`${t}`},getShaderSource:u,getRunData:()=>({outputs:[{dims:i,dataType:t}],dispatchGroup:{x:Math.ceil(a/64)},programUniforms:s})}},ox=r=>{let e=0,n=0,t=0;r.inputs[0].dataType===6?(e=r.inputs[0].getInt32Array()[0],n=r.inputs[1].getInt32Array()[0],t=r.inputs[2].getInt32Array()[0]):r.inputs[0].dataType===1&&(e=r.inputs[0].getFloat32Array()[0],n=r.inputs[1].getFloat32Array()[0],t=r.inputs[2].getFloat32Array()[0]),he.webgpu.validateInputContent&&FC(e,n,t),r.compute(WC(e,n,t,r.inputs[0].dataType),{inputs:[]})}});var HC,qC,ax,sx,ux=L(()=>{"use strict";ce();me();et();be();HC=(r,e,n,t)=>{if(r!=="none"&&t!=="i32"&&t!=="u32"&&t!=="f32")throw new Error(`Input ${t} is not supported with reduction ${r}.`);let o=`{
                var oldValue = 0;
                loop {
                  let newValueF32 =`,i=`;
                  let newValue = bitcast<i32>(newValueF32);
                  let res = atomicCompareExchangeWeak(&${e}, oldValue, newValue);
                  if res.exchanged {
                    break;
                  }
                  oldValue = res.old_value;
                }
              }`;switch(r){case"none":return`${e}=${n};`;case"add":return t==="i32"||t==="u32"?`atomicAdd(&${e}, bitcast<${t}>(${n}));`:`
              ${o}bitcast<${t}>(oldValue) + (${n})${i}`;case"max":return t==="i32"||t==="u32"?`atomicMax(&${e}, bitcast<${t}>(${n}));`:`
                ${o}max(bitcast<f32>(oldValue), (${n}))${i}`;case"min":return t==="i32"||t==="u32"?`atomicMin(&${e}, bitcast<${t}>(${n}));`:`${o}min(bitcast<${t}>(oldValue), (${n}))${i}`;case"mul":return`${o}(bitcast<${t}>(oldValue) * (${n}))${i}`;default:throw new Error(`Reduction ${r} is not supported.`)}},qC=(r,e)=>{let n=r[0].dims,t=r[1].dims,o=n,i=1,a=Math.ceil(k.sizeToDimension(t,t.length-1)/i),s=t[t.length-1],u=k.sizeFromDimension(n,s),l=[{type:12,data:a},{type:12,data:s},{type:12,data:u},...K(r[1].dims,r[2].dims,o)],d=p=>{let h=M("indices",r[1].dataType,r[1].dims.length),g=M("updates",r[2].dataType,r[2].dims.length,i),b=e.reduction!=="none"&&e.reduction!==""?N_("output",r[0].dataType,o.length):H("output",r[0].dataType,o.length,i);return`
      ${p.registerUniform("output_size","u32").registerUniform("last_index_dimension","u32").registerUniform("num_updates_elements","u32").declareVariables(h,g,b)}
      ${p.mainStart()}
        ${p.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
  var data_offset = 0u;
  let indices_start = uniforms.last_index_dimension * global_idx;
  let indices_end = indices_start + uniforms.last_index_dimension;
  for (var i = indices_start; i < indices_end; i++) {
    var index = i32(indices[i].x);
    ${r[0].dims.length===1?`
    let element_count_dim = uniforms.output_strides;
    let dim_value = uniforms.output_shape;`:`
    let element_count_dim = uniforms.output_strides[i - indices_start];
    let dim_value = uniforms.output_shape[i - indices_start];`}
    if (index >= 0) {
      if (index >= i32(dim_value)) {
        index = i32(dim_value - 1);
      }
    } else {
      if (index < -i32(dim_value)) {
        index = 0;
      } else {
        index += i32(dim_value);
      }
    }
    data_offset += u32((u32(index) * element_count_dim));
  }

  for (var i = 0u; i < uniforms.num_updates_elements; i++) {
    let value = updates[uniforms.num_updates_elements * global_idx + i];
    ${HC(e.reduction,"output[data_offset + i]","value",b.type.value)}
  }

      }`};return{name:"ScatterND",shaderCache:{hint:`${e.cacheKey}_${e.reduction}`,inputDependencies:["rank","rank"]},getRunData:()=>({outputs:[{dims:o,dataType:r[0].dataType}],dispatchGroup:{x:Math.ceil(a/64)},programUniforms:l}),getShaderSource:d}},ax=r=>de({reduction:r.reduction}),sx=(r,e)=>{r.compute(qC(r.inputs,e),{inputs:[r.inputs[1],r.inputs[2]],outputs:[]})}});var jC,KC,XC,lx,ZC,JC,YC,QC,eD,tD,nD,rD,cx,oD,iD,aD,sD,uD,dx,px,fx=L(()=>{"use strict";ce();me();et();be();jC=(r,e)=>{if(r.every(n=>n>0||(()=>{throw new Error("Resize requires scales input values to be positive")})),r.length>0){if(e.mode==="linear"){if(!(r.length===2||r.length===3||r.length===4&&r[0]===1&&r[1]===1||r.length===4&&r[0]===1&&r[3]===1||r.length===5&&r[0]===1&&r[1]===1))throw new Error(`For linear mode, Resize requires scales to be 2D, 3D, 4D with either two outermost or one innermost and
            one outermost scale values equal to 1, or 5D with two outermost scale values equal to 1`)}else if(e.mode==="cubic"&&!(r.length===2||r.length===4&&r[0]===1&&r[1]===1||r.length===4&&r[0]===1&&r[3]===1))throw new Error("Resize requires scales input size to be 2 or 4 for cubic mode")}},KC=(r,e,n)=>{e.every(o=>o>=0&&o<n||(()=>{throw new Error("Resize requires axes input values to be positive and less than rank")}));let t=new Array(n).fill(1);return e.forEach((o,i)=>t[o]=r[i]),t},XC=(r,e,n,t,o,i)=>{let[a,s,u]=n>10?[1,2,3]:[-1,r.length>1?1:-1,-1],l=r[0].dims.length;if(a>0&&r.length>a&&r[a].dims.length>0)r[a].getFloat32Array().forEach(d=>i.push(d));else if(e.coordinateTransformMode==="tf_crop_and_resize")throw new Error("Resize requires RoI input to be specified when coordinateTransformMode is tfCropAndResize");if(s>0&&r.length>s&&r[s].dims.length===1&&r[s].dims[0]>0){if(r[s].getFloat32Array().forEach(d=>t.push(d)),t.length!==0&&t.length!==l&&n>=18&&t.length!==e.axes.length)throw new Error("Resize requires scales input size to be same as input rank or axes size for opset 18 and up");jC(t,e),e.axes.length>0&&KC(t,e.axes,l).forEach((d,p)=>t[p]=d)}if(u>0&&r.length>u&&r[u].dims.length===1&&r[u].dims[0]>0&&(r[u].getBigInt64Array().forEach(d=>o.push(Number(d))),o.length!==0&&o.length!==l&&n>=18&&o.length!==e.axes.length))throw new Error("Resize requires sizes input size to be same as input rank or axes size for opset 18 and up");if(e.axes.length>0){if(t.length!==0&&t.length!==e.axes.length)throw new Error('Resize requires "scales" input size to be of axes rank when axes attributes is specified');if(o.length!==0&&o.length!==e.axes.length)throw new Error('Resize requires "sizes" input size to be of rank axes rank when axes attributes is specified')}if(typeof t<"u"&&typeof o<"u"&&t.length>0&&o.length>l)throw new Error("Resize requires only of scales or sizes to be specified")},lx=(r,e,n,t)=>`
  // The whole part and the fractional part are calculated separately due to inaccuracy of floating
  // point division. As an example, f32(21) / f32(7) may evaluate to 2.99... instead of 3, causing an
  // offset-by-one error later in floor().
  let big = (${r}) * (${e});
  let whole = ${t}(big / (${n}));
  let fract = ${t}(big % (${n})) / ${t}(${n});
  return whole + fract;
`,ZC=(r,e)=>`fn getOriginalCoordinateFromResizedCoordinate(xResized: u32, xScale: f32, lengthResized: u32,
     lengthOriginal: u32, roiStart: f32, roiEnd: f32) -> ${e} { `+(()=>{switch(r){case"asymmetric":return`
          if (xScale < 1.0 || floor(xScale) != xScale) {
            return ${e}(xResized) / ${e}(xScale);
          } else {
            ${lx("xResized","lengthOriginal","lengthResized",e)}
          }
        `;case"pytorch_half_pixel":return`if (lengthResized > 1) {
                    return (${e}(xResized) + 0.5) / ${e}(xScale) - 0.5;
                  } else {
                    return 0.0;
                  }`;case"tf_half_pixel_for_nn":return`return (${e}(xResized) + 0.5) / ${e}(xScale);`;case"align_corners":return`if (lengthResized == 1) {
                    return 0.0;
                  } else {
                    ${lx("xResized","lengthOriginal - 1","lengthResized - 1",e)}
                  }`;case"tf_crop_and_resize":return`if (lengthResized > 1) {
                    return ${e}(roiStart) * ${e}(lengthOriginal - 1) +
                        (${e}(xResized) * ${e}(roiEnd - roiStart) * ${e}(lengthOriginal - 1)) /
                        ${e}(lengthResized - 1);
                  } else {
                    return 0.5 * ${e}(roiStart + roiEnd) * ${e}(lengthOriginal - 1);
                  }`;case"half_pixel_symmetric":return`const outputWidth = ${e}xScale * ${e}(lengthResized);
                  const adjustment = ${e}(lengthResized) / outputWidth;
                  const center = ${e}(lengthOriginal) / 2;
                  const offset = center * (1 - adjustment);
                  return offset + ((${e}(xResized) + 0.5) / ${e}(xScale)) - 0.5;`;case"half_pixel":return`return ((${e}(xResized) + 0.5) / ${e}(xScale)) - 0.5;`;default:throw new Error(`Coordinate transform mode ${r} is not supported`)}})()+"}",JC=(r,e,n)=>`fn getNearestPixelFromOriginal(xOriginal: ${n}, isDownSample: bool) -> ${n} {`+(()=>{switch(r){case"round_prefer_ceil":return"if (fract(xOriginal) == 0.5) {             return ceil(xOriginal);           } else {             return round(xOriginal);           }";case"floor":return"return floor(xOriginal);";case"ceil":return"return ceil(xOriginal);";case"round_prefer_floor":return"if (fract(xOriginal) == 0.5) {                     return floor(xOriginal);                   } else {                     return round(xOriginal);                   }";case"simple":default:if(e<11)return"if (isDownSample)                     {                       return ceil(xOriginal);                     } else {                       return xOriginal;                     }";throw new Error(`Nearest mode ${r} is not supported`)}})()+"}",YC=(r,e,n)=>{let t=new Array(n).fill(0).concat(new Array(n).fill(1)),o=r.length===0?t:r.slice();return e.length>0?(e.forEach((i,a)=>{t[i]=o[a],t[a+n]=o[e.length+a]}),t):o},QC=(r,e,n,t)=>{let o=[];if(n.length>0)if(t.length>0){if(r.forEach(i=>o.push(i)),Math.max(...t)>r.length)throw new Error("axes is out of bound");t.forEach((i,a)=>o[i]=n[a])}else n.forEach(i=>o.push(i));else{if(e.length===0)throw new Error("Resize requires either scales or sizes.");o=r.map((i,a)=>Math.round(i*e[a]))}return o},eD=(r,e,n)=>{let t=(()=>{switch(n.keepAspectRatioPolicy){case"not_larger":return n.axes.length>0?Math.min(...n.axes.map(i=>e[i]),Number.MAX_VALUE):Math.min(...e,Number.MAX_VALUE);case"not_smaller":return n.axes.length>0?Math.max(...n.axes.map(i=>e[i]),Number.MIN_VALUE):Math.max(...e,Number.MIN_VALUE);default:throw new Error(`Keep aspect ratio policy ${n.keepAspectRatioPolicy} is not supported`)}})();e.fill(1,0,e.length);let o=r.slice();return n.axes.length>0?(n.axes.forEach(i=>e[i]=t),n.axes.forEach(i=>o[i]=Math.round(r[i]*e[i]))):(e.fill(t,0,e.length),o.forEach((i,a)=>o[a]=Math.round(i*e[a]))),o},tD=(r,e,n,t,o)=>`
    fn calculateOriginalIndicesFromOutputIndices(output_indices: ${r.type.indices}) -> array<${r.type.value}, ${n.length}> {
      var original_indices: array<${r.type.value}, ${n.length}>;
      for (var i:u32 = 0; i < ${n.length}; i++) {
        var output_index = ${r.indicesGet("output_indices","i")};
        var scale = ${re("uniforms.scales","i",t)};
        var roi_low = ${re("uniforms.roi","i",o)};
        var roi_hi = ${re("uniforms.roi",`i + ${e.length}`,o)};
        if (scale == 1.0) {
          original_indices[i] = ${r.type.value}(output_index);
        } else {
          var input_shape_i = ${re("uniforms.input_shape","i",e.length)};
          var output_shape_i = ${re("uniforms.output_shape","i",n.length)};
          original_indices[i] = getOriginalCoordinateFromResizedCoordinate(output_index, scale, output_shape_i,
                                                                           input_shape_i, roi_low, roi_hi);
        }
      }
      return original_indices;
    }`,nD=(r,e,n,t,o,i,a)=>`
    fn calculateInputIndicesFromOutputIndices(output_indices: ${e.type.indices}) -> ${r.type.indices} {
      var input_indices: ${r.type.indices};
      for (var i:u32 = 0; i < ${t.length}; i++) {
        var output_index = ${e.indicesGet("output_indices","i")};
        var input_index: u32;
        var scale = ${re("uniforms.scales","i",o)};
        if (scale == 1.0) {
          input_index = output_index;
        } else {
          var roi_low = ${re("uniforms.roi","i",i)};
          var roi_hi = ${re("uniforms.roi",`i + ${n.length}`,i)};
          var input_shape_i = ${re("uniforms.input_shape","i",n.length)};
          var output_shape_i = ${re("uniforms.output_shape","i",t.length)};
          var original_idx = getOriginalCoordinateFromResizedCoordinate(output_index, scale, output_shape_i,
                                                                        input_shape_i, roi_low, roi_hi);
          if (!${a} || (original_idx >= 0 && original_idx < ${e.type.value}(input_shape_i))) {
            if (original_idx < 0) {
              input_index = 0;
            } else if (original_idx > ${e.type.value}(input_shape_i - 1)) {
              input_index = input_shape_i - 1;
            } else {
              input_index = u32(getNearestPixelFromOriginal(original_idx, scale < 1));
            }
          } else {
            input_index = u32(original_idx);
          }
        }
        ${r.indicesSet("input_indices","i","input_index")}
      }
      return input_indices;
    }`,rD=(r,e)=>`
    fn checkInputIndices(input_indices: ${r.type.indices}) -> bool {
      for (var i:u32 = 0; i < ${e.length}; i++) {
        var input_index = ${r.indicesGet("input_indices","i")};
        if (input_index < 0 || input_index >= ${re("uniforms.input_shape","i",e.length)}) {
          return false;
        }
      }
      return true;
    }`,cx=(r,e,n,t)=>r.rank>t?`
    ${r.indicesSet("input_indices",e,"channel")};
    ${r.indicesSet("input_indices",n,"batch")};
`:"",oD=(r,e,n,t,o)=>{let[a,s,u,l]=n.length===2?[-1,0,1,-1]:[0,2,3,1],d=r.type.value;return`
    fn getInputValue(batch: u32, channel: u32, row: u32, col: u32) -> ${d} {
      var input_indices: ${r.type.indices};
      ${r.indicesSet("input_indices",s,`max(0, min(row, ${n[s]} - 1))`)};
      ${r.indicesSet("input_indices",u,`max(0, min(col, ${n[u]} - 1))`)};
      ${cx(r,l,a,2)}
      return ${r.getByIndices("input_indices")};
    }

    fn bilinearInterpolation(output_indices: ${e.type.indices}) -> ${d} {
      var originalIndices = calculateOriginalIndicesFromOutputIndices(output_indices);
      var row:${d} = originalIndices[${s}];
      var col:${d} = originalIndices[${u}];
      ${t?`if (row < 0 || row > (${n[s]} - 1) || col < 0 || col > (${n[u]} - 1)) {
        return ${o};
      }`:""};
      row = max(0, min(row, ${n[s]} - 1));
      col = max(0, min(col, ${n[u]} - 1));
      var row1: u32 = u32(row);
      var col1: u32 = u32(col);
      var row2: u32 = u32(row + 1);
      var col2: u32 = u32(col + 1);
      var channel: u32 = ${n.length>2?`u32(originalIndices[${l}])`:"0"};
      var batch: u32 =  ${n.length>2?`u32(originalIndices[${a}])`:"0"};
      var x11: ${d} = getInputValue(batch, channel, row1, col1);
      var x12: ${d} = getInputValue(batch, channel, row1, col2);
      var x21: ${d} = getInputValue(batch, channel, row2, col1);
      var x22: ${d} = getInputValue(batch, channel, row2, col2);
      var dx1: ${d} = abs(row - ${d}(row1));
      var dx2: ${d} = abs(${d}(row2) - row);
      var dy1: ${d} = abs(col - ${d}(col1));
      var dy2: ${d} = abs(${d}(col2) - col);
      if (row1 == row2) {
        dx1 = 0.5;
        dx2 = 0.5;
      }
      if (col1 == col2) {
        dy1 = 0.5;
        dy2 = 0.5;
      }
      return (x11 * dx2 * dy2 + x12 * dx2 * dy1 + x21 * dx1 * dy2 + x22 * dx1 * dy1);
    }`},iD=(r,e,n,t,o,i,a,s,u,l)=>{let d=n.length===2,p=!0,[h,g]=d?[0,1]:p?[2,3]:[1,2],b=r.type.value,_=S=>{let v=S===h?"row":"col";return`
      fn ${v}CubicInterpolation(input_indices: ${r.type.indices}, output_indices: ${e.type.indices}) -> ${b} {
        var output_index = ${e.indicesGet("output_indices",S)};
        var originalIdx: ${b} = getOriginalCoordinateFromResizedCoordinate(output_index, ${o[S]},
        ${t[S]}, ${n[S]}, ${i[S]}, ${i[S]} + ${n.length});
        var fractOriginalIdx: ${b} = originalIdx - floor(originalIdx);
        var coefs = getCubicInterpolationCoefs(fractOriginalIdx);

        if (${s} && (originalIdx < 0 || originalIdx > (${n[S]} - 1))) {
          return ${u};
        }
        var data: array<${b}, 4> = array<${b}, 4>(0.0, 0.0, 0.0, 0.0);
        for (var i: i32 = -1; i < 3; i++) {
          var ${v}: ${b} = originalIdx + ${b}(i);
          if (${v} < 0 || ${v} >= ${n[S]}) {
            ${l?`coefs[i + 1] = 0.0;
                        continue;`:s?`return ${u};`:`${v} = max(0, min(${v}, ${n[S]} - 1));`};
          }
        var input_indices_copy: ${r.type.indices} = input_indices;
          ${r.indicesSet("input_indices_copy",S,`u32(${v})`)};
          data[i + 1] = ${S===h?r.getByIndices("input_indices_copy"):"rowCubicInterpolation(input_indices_copy, output_indices)"};
        }
        return cubicInterpolation1D(data, coefs);
      }`};return`
    ${_(h)};
    ${_(g)};
  fn getCubicInterpolationCoefs(s: ${b}) -> array<${b}, 4> {
    var absS = abs(s);
    var coeffs: array<${b}, 4> = array<${b}, 4>(0.0, 0.0, 0.0, 0.0);
    var oneMinusAbsS: ${b} = 1.0 - absS;
    var twoMinusAbsS: ${b} = 2.0 - absS;
    var onePlusAbsS: ${b} = 1.0 + absS;
    coeffs[0] = ((${a} * onePlusAbsS - 5 * ${a}) * onePlusAbsS + 8 * ${a}) * onePlusAbsS - 4 * ${a};
    coeffs[1] = ((${a} + 2) * absS - (${a} + 3)) * absS * absS + 1;
    coeffs[2] = ((${a} + 2) * oneMinusAbsS - (${a} + 3)) * oneMinusAbsS * oneMinusAbsS + 1;
    coeffs[3] = ((${a} * twoMinusAbsS - 5 * ${a}) * twoMinusAbsS + 8 * ${a}) * twoMinusAbsS - 4 * ${a};
    return coeffs;
  }

  fn cubicInterpolation1D(x: array<${b}, 4>, coefs: array<${b}, 4>) -> ${b} {
    var coefsSum: ${b} = coefs[0] + coefs[1] + coefs[2] + coefs[3];
    return (x[0] * coefs[0] + x[1] * coefs[1]+ x[2] * coefs[2]+ x[3] * coefs[3]) / coefsSum;
  }

  fn bicubicInterpolation(output_indices: ${e.type.indices}) -> ${b} {
    var input_indices: ${r.type.indices} = output_indices;
    return colCubicInterpolation(input_indices, output_indices);
  }
    `},aD=(r,e,n,t,o)=>{let[a,s,u,l,d]=n.length===3?[-1,0,1,2,-1]:[0,2,3,4,1],p=r.type.value;return`
    fn getInputValue(batch: u32, channel: u32, depth:u32, height: u32, width: u32) -> ${p} {
      var input_indices: ${r.type.indices};
      ${r.indicesSet("input_indices",s,`max(0, min(depth, ${n[s]} - 1))`)};
      ${r.indicesSet("input_indices",u,`max(0, min(height, ${n[u]} - 1))`)};
      ${r.indicesSet("input_indices",l,`max(0, min(width, ${n[l]} - 1))`)};
      ${cx(r,d,a,3)}
      return ${r.getByIndices("input_indices")};
    }

    fn trilinearInterpolation(output_indices: ${e.type.indices}) -> ${p} {
      var originalIndices = calculateOriginalIndicesFromOutputIndices(output_indices);
      var depth:${p} = originalIndices[${s}];
      var height:${p} = originalIndices[${u}];
      var width:${p} = originalIndices[${l}];
      ${t?`if (depth < 0 || depth > (${n[s]} - 1) || height < 0 || height > (${n[u]} - 1) || width < 0 || (width > ${n[l]} - 1)) {
      return ${o};
        }`:""};

    depth = max(0, min(depth, ${n[s]} - 1));
      height = max(0, min(height, ${n[u]} - 1));
      width = max(0, min(width, ${n[l]} - 1));
      var depth1: u32 = u32(depth);
      var height1: u32 = u32(height);
      var width1: u32 = u32(width);
      var depth2: u32 = u32(depth + 1);
      var height2: u32 = u32(height + 1);
      var width2: u32 = u32(width + 1);
      var channel: u32 = ${n.length>3?`u32(originalIndices[${d}])`:"0"};
      var batch: u32 =  ${n.length>3?`u32(originalIndices[${a}])`:"0"};

      var x111: ${p} = getInputValue(batch, channel, depth1, height1, width1);
      var x112: ${p} = getInputValue(batch, channel, depth1, height1, width2);
      var x121: ${p} = getInputValue(batch, channel, depth1, height2, width1);
      var x122: ${p} = getInputValue(batch, channel, depth1, height2, width2);
      var x211: ${p} = getInputValue(batch, channel, depth2, height1, width1);
      var x212: ${p} = getInputValue(batch, channel, depth2, height1, width2);
      var x221: ${p} = getInputValue(batch, channel, depth2, height2, width1);
      var x222: ${p} = getInputValue(batch, channel, depth2, height2, width2);
      var dx1: ${p} = abs(depth - ${p}(depth1));
      var dx2: ${p} = abs(${p}(depth2) - depth);
      var dy1: ${p} = abs(height - ${p}(height1));
      var dy2: ${p} = abs(${p}(height2) - height);
      var dz1: ${p} = abs(width - ${p}(width1));
      var dz2: ${p} = abs(${p}(width2) - width);
      if (depth1 == depth2) {
        dx1 = 0.5;
        dx2 = 0.5;
      }
      if (height1 == height2) {
        dy1 = 0.5;
        dy2 = 0.5;
      }
      if (width1 == width2) {
        dz1 = 0.5;
        dz2 = 0.5;
      }
      return (x111 * dx2 * dy2 * dz2 + x112 * dx2 * dy2 * dz1 + x121 * dx2 * dy1 *dz2 + x122 * dx2 * dy1 * dz1 +
              x211 * dx1 * dy2 * dz2 + x212 * dx1 * dy2 * dz1 + x221 * dx1 * dy1 *dz2 + x222 * dx1 * dy1 * dz1);
    }`},sD=(r,e,n,t,o,i)=>{let a=r.dims,s=YC(i,e.axes,a.length),u=QC(a,t,o,e.axes),l=t.slice();t.length===0&&(l=a.map((x,$)=>x===0?1:u[$]/x),e.keepAspectRatioPolicy!=="stretch"&&(u=eD(a,l,e)));let d=H("output",r.dataType,u.length),p=M("input",r.dataType,a.length),h=k.size(u),g=a.length===u.length&&a.every((x,$)=>x===u[$]),b=e.coordinateTransformMode==="tf_crop_and_resize",_=e.extrapolationValue,S=p.type.value,v=x=>`
      ${g?"":`
      ${ZC(e.coordinateTransformMode,S)};
      ${(()=>{switch(e.mode){case"nearest":return`
              ${rD(p,a)};
              ${JC(e.nearestMode,n,S)};
              ${nD(p,d,a,u,l.length,s.length,b)};
              `;case"linear":return`
              ${tD(d,a,u,l.length,s.length)};
              ${(()=>{if(a.length===2||a.length===4)return`${oD(p,d,a,b,_)}`;if(a.length===3||a.length===5)return`${aD(p,d,a,b,_)}`;throw Error("Linear mode only supports input dims 2, 3, 4 and 5 are supported in linear mode.")})()};
            `;case"cubic":return`
            ${(()=>{if(a.length===2||a.length===4)return`${iD(p,d,a,u,l,s,e.cubicCoeffA,b,e.extrapolationValue,e.excludeOutside)}`;throw Error("Cubic mode only supports input dims 2 and 4 are supported in linear mode.")})()};
            `;default:throw Error("Invalid resize mode")}})()};
      `}
      ${x.registerUniform("output_size","u32").registerUniform("scales","f32",l.length).registerUniform("roi","f32",s.length).declareVariables(p,d)}
      ${x.mainStart()}
        ${x.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
        ${g?"output[global_idx] = input[global_idx];":`
        let output_indices = ${d.offsetToIndices("global_idx")};
        var input_indices: ${p.type.indices};
        ${(()=>{switch(e.mode){case"nearest":return`input_indices = calculateInputIndicesFromOutputIndices(output_indices);
                if (checkInputIndices(input_indices)) {
                  output[global_idx] = ${p.getByIndices("input_indices")};
                } else {
                  output[global_idx] = ${e.extrapolationValue};
                }`;case"linear":return`output[global_idx] = ${a.length===2||a.length===4?"bilinearInterpolation":"trilinearInterpolation"}(output_indices);`;case"cubic":return"output[global_idx] = bicubicInterpolation(output_indices);";default:throw Error(`Unsupported resize mode: ${e.mode}`)}})()};
`}
      }`;return{name:"Resize",shaderCache:{hint:`${e.cacheKey}|${n}|${l.length>0?e.mode==="cubic"?l:l.length:""}|${o.length>0?o:""}|${s.length>0?s:""}|${g}|${e.mode==="nearest"?a.length:a}`,inputDependencies:["rank"]},getShaderSource:v,getRunData:()=>({outputs:[{dims:u,dataType:r.dataType}],dispatchGroup:{x:Math.ceil(h/64)},programUniforms:[{type:12,data:h},{type:1,data:l},{type:1,data:s},...K(a,u)]})}},uD=r=>{let e=r.customDataBuffer;return new Uint32Array(e.buffer,e.byteOffset,1)[0]},dx=(r,e)=>{let n=[],t=[],o=[],i=uD(r);if(e.antialias!==0)throw Error("Only default value (0) for Antialias attribute is supported");XC(r.inputs,e,i,n,t,o),r.compute(sD(r.inputs[0],e,i,n,t,o),{inputs:[0]})},px=r=>{let e=r.antialias,n=r.axes,t=r.coordinateTransformMode,o=r.cubicCoeffA,i=r.excludeOutside!==0,a=r.extrapolationValue,s=r.keepAspectRatioPolicy,u=r.mode,l=r.nearestMode===""?"simple":r.nearestMode;return de({antialias:e,axes:n,coordinateTransformMode:t,cubicCoeffA:o,excludeOutside:i,extrapolationValue:a,keepAspectRatioPolicy:s,mode:u,nearestMode:l})}});var lD,cD,hx,mx=L(()=>{"use strict";ce();me();be();lD=r=>{if(!r||r.length<3)throw new Error("layerNorm requires at least 3 inputs.");let e=r[0],n=r[1],t=r[2];if(e.dataType!==n.dataType||e.dataType!==t.dataType)throw new Error("All inputs must have the same data type");if(e.dims.length!==3&&e.dims.length!==2)throw new Error("Input must be 2D or 3D");if(n.dims.length!==3&&n.dims.length!==2)throw new Error("Skip must be 2D or 3D");let o=e.dims[e.dims.length-1],i=e.dims[e.dims.length-2];if(n.dims[n.dims.length-1]!==o)throw new Error("Skip must have the same hidden size as input");if(n.dims[n.dims.length-2]!==i)throw new Error("Skip must have the same sequence length as input");if(t.dims.length!==1)throw new Error("Gamma must be 1D");if(t.dims[t.dims.length-1]!==o)throw new Error("Gamma must have the same hidden size as input");if(r.length>3){let a=r[3];if(a.dims.length!==1)throw new Error("Beta must be 1D");if(a.dims[a.dims.length-1]!==o)throw new Error("Beta must have the same hidden size as input")}if(r.length>4){let a=r[4];if(a.dims.length!==1)throw new Error("Bias must be 1D");if(a.dims[a.dims.length-1]!==o)throw new Error("Bias must have the same hidden size as input")}},cD=(r,e,n,t)=>{let o=e.simplified,i=r[0].dims,a=k.size(i),s=i,u=a,l=i.slice(-1)[0],d=t?i.slice(0,-1).concat(1):[],p=!o&&r.length>3,h=r.length>4,g=t&&n>1,b=t&&n>2,_=n>3,S=64,v=Ce(l),x=[{type:12,data:u},{type:12,data:v},{type:12,data:l},{type:1,data:e.epsilon}],$=E=>{let D=[{name:"output_size",type:"u32"},{name:"components",type:"u32"},{name:"hidden_size",type:"u32"},{name:"epsilon",type:"f32"}],B=[M("x",r[0].dataType,r[0].dims,v),M("skip",r[1].dataType,r[1].dims,v),M("gamma",r[2].dataType,r[2].dims,v)];p&&B.push(M("beta",r[3].dataType,r[3].dims,v)),h&&B.push(M("bias",r[4].dataType,r[4].dims,v)),B.push(H("output",r[0].dataType,s,v)),g&&B.push(H("mean_output",1,d)),b&&B.push(H("inv_std_output",1,d)),_&&B.push(H("input_skip_bias_sum",r[0].dataType,s,v));let T=Ue(r[0].dataType),F=Ue(1,v);return`

      ${E.registerUniforms(D).declareVariables(...B)}
      var<workgroup> sum_shared : array<${F}, ${S}>;
      var<workgroup> sum_squared_shared : array<${F}, ${S}>;

      ${E.mainStart([S,1,1])}
        let ix = local_id.x;
        let iy = global_id.x / ${S};

        let hidden_size_vectorized: u32 = uniforms.hidden_size / uniforms.components;
        var stride = hidden_size_vectorized / ${S};
        let offset = ix * stride + iy * hidden_size_vectorized;
        let offset1d = stride * ix;
        if (ix == ${S-1}) {
          stride = hidden_size_vectorized - stride * ix;
        }
        for (var i: u32 = 0; i < stride; i++) {
          let skip_value = skip[offset + i];
          let bias_value = ${h?"bias[offset1d + i]":T+"(0.0)"};
          let input_value = x[offset + i];
          let value = input_value + skip_value + bias_value;
          ${_?"input_skip_bias_sum[offset + i] = value;":""}
          output[offset + i] = value;
          let f32_value = ${Ur(T,v,"value")};
          sum_shared[ix] += f32_value;
          sum_squared_shared[ix] += f32_value * f32_value;
        }
        workgroupBarrier();

        var reduce_size : u32 = ${S};
        for (var curr_size = reduce_size >> 1;  curr_size > 0; curr_size = reduce_size >> 1) {
          reduce_size = curr_size + (reduce_size & 1);
          if (ix < curr_size) {
            sum_shared[ix] += sum_shared[ix + reduce_size];
            sum_squared_shared[ix] += sum_squared_shared[ix + reduce_size];
          }
          workgroupBarrier();
        }

        let sum = sum_shared[0];
        let square_sum = sum_squared_shared[0];
        let mean = ${Zt("sum",v)} / f32(uniforms.hidden_size);
        let inv_std_dev = inverseSqrt(${Zt("square_sum",v)} / f32(uniforms.hidden_size) ${o?"":"- mean * mean"} + uniforms.epsilon);
        ${g?"mean_output[global_idx] = mean;":""}
        ${b?"inv_std_output[global_idx] = inv_std_dev;":""}

        for (var i: u32 = 0; i < stride; i++) {
          output[offset + i] = (output[offset + i] ${o?"":`- ${T}(mean)`}) *
            ${T}(inv_std_dev) * gamma[offset1d + i]
            ${p?"+ beta[offset1d + i]":""};
        }
      }`},O=[{dims:s,dataType:r[0].dataType}];return n>1&&O.push({dims:d,dataType:1}),n>2&&O.push({dims:d,dataType:1}),n>3&&O.push({dims:i,dataType:r[0].dataType}),{name:"SkipLayerNormalization",shaderCache:{hint:`${v};${g};${b};${_}`,inputDependencies:r.map((E,D)=>"type")},getShaderSource:$,getRunData:()=>({outputs:O,dispatchGroup:{x:Math.ceil(u/l)},programUniforms:x})}},hx=(r,e)=>{lD(r.inputs);let t=[0];r.outputCount>1&&t.push(-3),r.outputCount>2&&t.push(-3),r.outputCount>3&&t.push(3),r.compute(cD(r.inputs,e,r.outputCount,!1),{outputs:t})}});var dD,ns,pD,gx,fD,hD,bx,yx,_x=L(()=>{"use strict";ce();me();et();be();dD=(r,e)=>{if(!r||r.length<1)throw new Error("too few inputs");if(e.axes.length!==0){if(e.axes.length!==e.starts.length||e.axes.length!==e.ends.length)throw new Error("axes, starts and ends must have the same length")}else if(e.starts.length!==e.ends.length)throw new Error("starts and ends must have the same length");r.slice(1).forEach((n,t)=>{if(r[t+1].dataType!==6&&r[t+1].dataType!==7)throw new Error(`Input ${t} must be an array of int32 or int64`)})},ns=(r,e)=>{let n=[];if(r.length>e)if(r[e].dataType===7)r[e].getBigInt64Array().forEach(t=>n.push(Number(t)));else if(r[e].dataType===6)r[e].getInt32Array().forEach(t=>n.push(Number(t)));else throw new Error(`Input ${e} must be an array of int32 or int64`);return n},pD=(r,e)=>{if(r.length>1){let n=ns(r,1),t=ns(r,2),o=ns(r,3);return o.length===0&&(o=[...Array(r[0].dims.length).keys()]),de({starts:n,ends:t,axes:o})}else return e},gx=(r,e,n,t,o)=>{let i=r;return r<0&&(i+=n[t[e]]),o[e]<0?Math.max(0,Math.min(i,n[t[e]]-1)):Math.max(0,Math.min(i,n[t[e]]))},fD=(r,e,n)=>`fn calculateInputIndices(output_indices: ${e.type.indices}) -> ${r.type.indices} {
          var input_indices: ${r.type.indices};
          var carry = 0u;
          for (var i = ${n.length-1}; i >= 0; i--) {
            let input_shape_i = ${re("uniforms.input_shape","i",n.length)};
            let steps_i = ${re("uniforms.steps","i",n.length)};
            let signs_i = ${re("uniforms.signs","i",n.length)};
            let starts_i = ${re("uniforms.starts","i",n.length)};
            var output_index = ${e.indicesGet("output_indices","i")};
            var input_index = output_index * steps_i + starts_i + carry;
            carry = input_index / input_shape_i;
            input_index = input_index % input_shape_i;
            if (signs_i < 0) {
              input_index = input_shape_i - input_index - 1u + starts_i;
            }
            ${r.indicesSet("input_indices","i","input_index")};
          }
          return input_indices;
      }`,hD=(r,e)=>{let n=r[0].dims,t=k.size(n),o=e.axes.length>0?k.normalizeAxes(e.axes,n.length):[...Array(n.length).keys()],i=ns(r,4);i.forEach(v=>v!==0||(()=>{throw new Error("step cannot be 0")})),i.length===0&&(i=Array(o.length).fill(1));let a=e.starts.map((v,x)=>gx(v,x,n,o,i)),s=e.ends.map((v,x)=>gx(v,x,n,o,i));if(o.length!==a.length||o.length!==s.length)throw new Error("start, ends and axes should have the same number of elements");if(o.length!==n.length)for(let v=0;v<n.length;++v)o.includes(v)||(a.splice(v,0,0),s.splice(v,0,n[v]),i.splice(v,0,1));let u=i.map(v=>Math.sign(v));i.forEach((v,x,$)=>{if(v<0){let O=(s[x]-a[x])/v,E=a[x],D=E+O*i[x];a[x]=D,s[x]=E,$[x]=-v}});let l=n.slice(0);o.forEach((v,x)=>{l[v]=Math.ceil((s[v]-a[v])/i[v])});let d={dims:l,dataType:r[0].dataType},p=H("output",r[0].dataType,l.length),h=M("input",r[0].dataType,r[0].dims.length),g=k.size(l),b=[{name:"outputSize",type:"u32"},{name:"starts",type:"u32",length:a.length},{name:"signs",type:"i32",length:u.length},{name:"steps",type:"u32",length:i.length}],_=[{type:12,data:g},{type:12,data:a},{type:6,data:u},{type:12,data:i},...K(r[0].dims,l)],S=v=>`
      ${v.registerUniforms(b).declareVariables(h,p)}
        ${fD(h,p,n)}
        ${v.mainStart()}
          ${v.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.outputSize")}
          let output_indices = ${p.offsetToIndices("global_idx")};
          let input_indices = calculateInputIndices(output_indices);
          ${p.setByOffset("global_idx",h.getByIndices("input_indices"))}
      }`;return{name:"Slice",shaderCache:{hint:`${u.length}_${a.length}_${i.length}`,inputDependencies:["rank"]},getShaderSource:S,getRunData:()=>({outputs:[d],dispatchGroup:{x:Math.ceil(t/64)},programUniforms:_})}},bx=(r,e)=>{dD(r.inputs,e);let n=pD(r.inputs,e);r.compute(hD(r.inputs,n),{inputs:[0]})},yx=r=>{let e=r.starts,n=r.ends,t=r.axes;return de({starts:e,ends:n,axes:t})}});var mD,gD,wx,vx,xx=L(()=>{"use strict";ce();me();et();Qn();be();mD=r=>{if(!r||r.length!==1)throw new Error("Softmax op requires 1 input.")},gD=(r,e)=>{let n=r.inputs[0],t=n.dims,o=k.size(t),i=t.length,a=k.normalizeAxis(e.axis,i),s=a<t.length-1,u,l=[];s?(l=Array.from({length:i},(B,T)=>T),l[a]=i-1,l[i-1]=a,u=r.compute(ct(n,l),{inputs:[n],outputs:[-1]})[0]):u=n;let d=u.dims,p=d[i-1],h=o/p,g=Ce(p),b=p/g,_=64;h===1&&(_=256);let S=(B,T)=>T===4?`max(max(${B}.x, ${B}.y), max(${B}.z, ${B}.w))`:T===2?`max(${B}.x, ${B}.y)`:T===3?`max(max(${B}.x, ${B}.y), ${B}.z)`:B,v=M("x",u.dataType,u.dims,g),x=H("result",u.dataType,u.dims,g),$=v.type.value,O=Ue(u.dataType)==="f32"?`var threadMax = ${$}(-3.4028234663852886e+38f);`:`var threadMax = ${$}(-65504.0h);`,E=B=>`
      var<workgroup> rowMaxShared : ${$};
      var<workgroup> rowSumShared : ${$};
      var<workgroup> threadShared : array<${$}, ${_}>;

      fn getValue(row: i32, col: i32, row_stride: i32) -> ${$} {
        let index = row * row_stride + col;
        return x[index];
      }

      fn setValue(row: i32, col: i32, row_stride: i32, value: ${$}) {
        let index = row * row_stride + col;
        result[index] = value;
      }
      ${B.registerUniform("packedCols","i32").declareVariables(v,x)}
      ${B.mainStart(_)}
        let gindex = i32(global_idx);
        let lindex = i32(local_idx);
        const wg = ${_};
        let row = gindex / wg;
        let cols = uniforms.packedCols;
        let row_stride : i32 = uniforms.packedCols;

        // find the rows max
        ${O}
        for (var col = lindex; col < cols; col += wg) {
          let value = getValue(row, col, row_stride);
          threadMax = max(threadMax, value);
        }
        if (lindex < cols) {
          threadShared[lindex] = threadMax;
        }
        workgroupBarrier();

        var reduceSize = min(cols, wg);
        for (var currSize = reduceSize >> 1;  currSize > 0; currSize = reduceSize >> 1) {
          reduceSize = currSize + (reduceSize & 1);
          if (lindex < currSize) {
            threadShared[lindex] = max(threadShared[lindex], threadShared[lindex + reduceSize]);
          }
          workgroupBarrier();
        }
        if (lindex == 0) {
          rowMaxShared = ${$}(${S("threadShared[0]",g)});
        }
        workgroupBarrier();

        // find the rows sum
        var threadSum = ${$}(0.0);
        for (var col = lindex; col < cols; col += wg) {
          let subExp = exp(getValue(row, col, row_stride) - rowMaxShared);
          threadSum += subExp;
        }
        threadShared[lindex] = threadSum;
        workgroupBarrier();

        for (var currSize = wg >> 1;  currSize > 0; currSize = currSize >> 1) {
          if (lindex < currSize) {
            threadShared[lindex] = threadShared[lindex] + threadShared[lindex + currSize];
          }
          workgroupBarrier();
        }
        if (lindex == 0) {
          rowSumShared = ${$}(${Zt("threadShared[0]",g)});
        }
        workgroupBarrier();

        // calculate final value for each element in the row
        for (var col = lindex; col < cols; col += wg) {
          var value = exp(getValue(row, col, row_stride) - rowMaxShared) / rowSumShared;
          // max operation protects against NaN since all values should be >=0
          value = max(value, ${$}(0.0));
          setValue(row, col, row_stride, value);
        }
      }`,D=r.compute({name:"Softmax",shaderCache:{hint:`${g};${_}`,inputDependencies:["type"]},getRunData:()=>({outputs:[{dims:d,dataType:u.dataType}],dispatchGroup:{x:h},programUniforms:[{type:6,data:b}]}),getShaderSource:E},{inputs:[u],outputs:[s?-1:0]})[0];s&&r.compute(ct(D,l),{inputs:[D]})},wx=(r,e)=>{mD(r.inputs),gD(r,e)},vx=r=>de({axis:r.axis})});var Tx,bD,yD,_D,Ix,Sx=L(()=>{"use strict";ce();me();be();Tx=r=>Array.from(r.getBigInt64Array(),Number),bD=r=>{if(!r||r.length!==2)throw new Error("Tile requires 2 inputs.");if(r[0].dataType!==1&&r[0].dataType!==10&&r[0].dataType!==6&&r[0].dataType!==12)throw new Error("Tile only support float, float16, int32, and uint32 data types");if(r[1].dataType!==7)throw new Error("Tile `repeats` input should be of int64 data type");if(r[1].dims.length!==1)throw new Error("Tile `repeats` input should be 1-D");if(Tx(r[1]).length!==r[0].dims.length)throw new Error("Tile `repeats` input should have same number of elements as rank of input data tensor")},yD=(r,e)=>{let n=[];for(let t=0;t<r.length;++t)n.push(r[t]*e[t]);return n},_D=(r,e)=>{let n=r[0].dims,t=e??Tx(r[1]),o=yD(n,t),i=k.size(o),a=r[0].dataType,s=M("input",a,n.length),u=H("output",a,o.length),l=d=>`
      const inputShape = ${s.indices(...n)};
      ${d.registerUniform("output_size","u32").declareVariables(s,u)}
      ${d.mainStart()}
      ${d.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.output_size")}
      let output_indices = ${u.offsetToIndices("global_idx")};
      var input_indices: ${s.type.indices};
      for (var i = 0; i < ${n.length}; i++) {
        let input_dim_i = ${s.indicesGet("uniforms.input_shape","i")};
        let input_dim_value = ${u.indicesGet("output_indices","i")}  % input_dim_i;

        ${s.indicesSet("input_indices","i","input_dim_value")}
      }
      ${u.setByOffset("global_idx",s.getByIndices("input_indices"))}
    }`;return{name:"Tile",shaderCache:{hint:`${t}`,inputDependencies:["rank"]},getRunData:()=>({outputs:[{dims:o,dataType:r[0].dataType}],dispatchGroup:{x:Math.ceil(i/64)},programUniforms:[{type:12,data:i},...K(r[0].dims,o)]}),getShaderSource:l}},Ix=r=>{bD(r.inputs),r.compute(_D(r.inputs),{inputs:[0]})}});var wD,vD,$x,Ax=L(()=>{"use strict";ce();me();be();wD=(r,e,n,t,o)=>{let i=H("output_data",o,n.length,4),a=M("a_data",e[1].dataType,e[1].dims.length,4),s=M("b_data",e[2].dataType,e[2].dims.length,4),u=M("c_data",e[0].dataType,e[0].dims.length,4),l,d=(p,h,g)=>`select(${h}, ${p}, ${g})`;if(!t)l=i.setByOffset("global_idx",d(a.getByOffset("global_idx"),s.getByOffset("global_idx"),u.getByOffset("global_idx")));else{let p=(h,g,b="")=>{let _=`a_data[index_a${g}][component_a${g}]`,S=`b_data[index_b${g}][component_b${g}]`,v=`bool(c_data[index_c${g}] & (0xffu << (component_c${g} * 8)))`;return`
            let output_indices${g} = ${i.offsetToIndices(`global_idx * 4u + ${g}u`)};
            let offset_a${g} = ${a.broadcastedIndicesToOffset(`output_indices${g}`,i)};
            let offset_b${g} = ${s.broadcastedIndicesToOffset(`output_indices${g}`,i)};
            let offset_c${g} = ${u.broadcastedIndicesToOffset(`output_indices${g}`,i)};
            let index_a${g} = offset_a${g} / 4u;
            let index_b${g} = offset_b${g} / 4u;
            let index_c${g} = offset_c${g} / 4u;
            let component_a${g} = offset_a${g} % 4u;
            let component_b${g} = offset_b${g} % 4u;
            let component_c${g} = offset_c${g} % 4u;
            ${h}[${g}] = ${b}(${d(_,S,v)});
          `};o===9?l=`
            var data = vec4<u32>(0);
            ${p("data",0,"u32")}
            ${p("data",1,"u32")}
            ${p("data",2,"u32")}
            ${p("data",3,"u32")}
            output_data[global_idx] = dot(vec4<u32>(0x1, 0x100, 0x10000, 0x1000000), vec4<u32>(data));`:l=`
            ${p("output_data[global_idx]",0)}
            ${p("output_data[global_idx]",1)}
            ${p("output_data[global_idx]",2)}
            ${p("output_data[global_idx]",3)}
          `}return`
        ${r.registerUniform("vec_size","u32").declareVariables(u,a,s,i)}
        ${r.mainStart()}
        ${r.guardAgainstOutOfBoundsWorkgroupSizes("uniforms.vec_size")}
        ${l}
      }`},vD=r=>{let e=r[1].dims,n=r[2].dims,t=r[0].dims,o=r[1].dataType,i=!(k.areEqual(e,n)&&k.areEqual(n,t)),a=e,s=k.size(e);if(i){let l=Fn.calcShape(Fn.calcShape(e,n,!1),t,!1);if(!l)throw new Error("Can't perform where op on the given tensors");a=l,s=k.size(a)}let u=Math.ceil(s/4);return{name:"Where",shaderCache:{inputDependencies:["rank","rank","rank"]},getShaderSource:l=>wD(l,r,a,i,o),getRunData:()=>({outputs:[{dims:a,dataType:o}],dispatchGroup:{x:Math.ceil(s/64/4)},programUniforms:[{type:12,data:u},...K(t,e,n,a)]})}},$x=r=>{r.compute(vD(r.inputs))}});var Ox,Px=L(()=>{"use strict";l0();Wa();p0();h0();Q0();cw();fw();Pw();Rw();Bw();Uw();jw();Zw();Yw();tv();ov();sv();cv();fv();gv();Sv();Ov();Ev();Dv();Lv();Gc();zv();ex();rx();ix();ux();Ua();fx();Wc();mx();_x();xx();Fc();Sx();Qn();qa();Ax();Ox=new Map([["Abs",[m0]],["Acos",[g0]],["Acosh",[b0]],["Add",[ew]],["ArgMax",[u0,Oc]],["ArgMin",[s0,Oc]],["Asin",[y0]],["Asinh",[_0]],["Atan",[w0]],["Atanh",[v0]],["Attention",[c0]],["AveragePool",[Hv,Wv]],["BatchNormalization",[d0]],["BiasAdd",[f0]],["BiasSplitGelu",[Y0]],["Cast",[T0,x0]],["Ceil",[S0]],["Clip",[I0]],["Concat",[dw,pw]],["Conv",[zc,Rc]],["ConvTranspose",[Lw,kw]],["Cos",[$0]],["Cosh",[A0]],["CumSum",[zw,Mw]],["DepthToSpace",[Vw,Gw]],["DequantizeLinear",[tx,nx]],["Div",[tw]],["Einsum",[Hw,qw]],["Elu",[O0,Ho]],["Equal",[nw]],["Erf",[P0]],["Exp",[E0]],["Expand",[Xw]],["FastGelu",[Jw]],["Floor",[C0]],["FusedConv",[zc,Rc]],["Gather",[ev,Qw]],["GatherElements",[lv,uv]],["GatherBlockQuantized",[iv,av]],["GatherND",[nv,rv]],["Gelu",[D0]],["Gemm",[pv,dv]],["GlobalAveragePool",[Kv,jv]],["GlobalMaxPool",[Qv,Yv]],["Greater",[aw]],["GreaterOrEqual",[uw]],["GridSample",[hv,mv]],["GroupQueryAttention",[Iv]],["HardSigmoid",[V0,B0]],["InstanceNormalization",[Av]],["LayerNormalization",[Pv]],["LeakyRelu",[k0,Ho]],["Less",[sw]],["LessOrEqual",[lw]],["Log",[X0]],["MatMul",[Cv]],["MatMulNBits",[kv,Nv]],["MaxPool",[Zv,Jv]],["Mul",[rw]],["MultiHeadAttention",[_v,yv]],["Neg",[L0]],["Not",[N0]],["Pad",[Rv]],["Pow",[ow]],["QuickGelu",[Z0,Ho]],["Range",[ox]],["Reciprocal",[R0]],["ReduceMin",[t0]],["ReduceMean",[Z_]],["ReduceMax",[e0]],["ReduceSum",[r0]],["ReduceProd",[n0]],["ReduceL1",[J_]],["ReduceL2",[Y_]],["ReduceLogSum",[i0]],["ReduceLogSumExp",[Q_]],["ReduceSumSquare",[o0]],["Relu",[z0]],["Resize",[dx,px]],["RotaryEmbedding",[xv]],["ScatterND",[sx,ax]],["Sigmoid",[M0]],["Sin",[G0]],["Sinh",[U0]],["Slice",[bx,yx]],["SkipLayerNormalization",[hx]],["Split",[wv,vv]],["Sqrt",[F0]],["Softmax",[wx,vx]],["Sub",[iw]],["Tan",[W0]],["Tanh",[q0]],["ThresholdedRelu",[K0,Ho]],["Tile",[Ix]],["Transpose",[z_,M_]],["Where",[$x]]])});var rs,Ex=L(()=>{"use strict";ht();Un();be();rs=class{constructor(e){this.backend=e;this.repo=new Map,this.attributesBound=!1}getArtifact(e){return this.repo.get(e)}setArtifact(e,n){this.repo.set(e,n)}run(e,n,t,o,i){At(e.programInfo.name);let a=this.backend.device,s=this.backend.getComputePassEncoder();this.backend.writeTimestamp(this.backend.pendingDispatchNumber*2);let u=[];for(let d of n)u.push({binding:u.length,resource:{buffer:d.buffer}});for(let d of t)u.push({binding:u.length,resource:{buffer:d.buffer}});i&&u.push({binding:u.length,resource:i});let l=a.createBindGroup({layout:e.computePipeline.getBindGroupLayout(0),entries:u,label:e.programInfo.name});if(this.backend.sessionStatus==="capturing"){let d={kernelId:this.backend.currentKernelId,computePipeline:e.computePipeline,bindGroup:l,dispatchGroup:o};this.backend.capturedCommandList.get(this.backend.currentSessionId).push(d)}s.setPipeline(e.computePipeline),s.setBindGroup(0,l),s.dispatchWorkgroups(...o),this.backend.writeTimestamp(this.backend.pendingDispatchNumber*2+1),this.backend.pendingDispatchNumber++,(this.backend.pendingDispatchNumber>=this.backend.maxDispatchNumber||this.backend.queryType==="at-passes")&&this.backend.endComputePass(),this.backend.pendingDispatchNumber>=this.backend.maxDispatchNumber&&this.backend.flush(),_t(e.programInfo.name)}dispose(){}build(e,n){At(e.name);let t=this.backend.device,o=[];[{feature:"shader-f16",extension:"f16"},{feature:"subgroups",extension:"subgroups"}].forEach(p=>{t.features.has(p.feature)&&o.push(`enable ${p.extension};`)});let a=L_(n,this.backend.device.limits),s=e.getShaderSource(a),u=`${o.join(`
`)}
${a.additionalImplementations}
${s}`,l=t.createShaderModule({code:u,label:e.name});_e("verbose",()=>`[WebGPU] ${e.name} shader code: ${u}`);let d=t.createComputePipeline({compute:{module:l,entryPoint:"main"},layout:"auto",label:e.name});return _t(e.name),{programInfo:e,computePipeline:d,uniformVariablesInfo:a.variablesInfo}}normalizeDispatchGroupSize(e){let n=typeof e=="number"?e:e.x,t=typeof e=="number"?1:e.y||1,o=typeof e=="number"?1:e.z||1,i=this.backend.device.limits.maxComputeWorkgroupsPerDimension;if(n<=i&&t<=i&&o<=i)return[n,t,o];let a=n*t*o,s=Math.ceil(Math.sqrt(a));if(s>i){if(s=Math.ceil(Math.cbrt(a)),s>i)throw new Error("Total dispatch size exceeds WebGPU maximum.");return[s,s,s]}else return[s,s,1]}}});var Cx={};Ir(Cx,{WebGpuBackend:()=>qc});var xD,TD,Hc,qc,Dx=L(()=>{"use strict";ht();ce();Un();gc();k_();Px();Ex();xD=(r,e)=>{if(e.length!==r.length)throw new Error(`inputDependencies length ${e.length} is not equal to inputTensors length ${r.length}.`);let n=[];for(let t=0;t<r.length;++t){let o=r[t].dataType;switch(e[t]){case"none":{n.push("");break}case"type":{n.push(`${o}`);break}case"rank":{let i=r[t].dims.length;n.push(`${o};${i}`);break}case"dims":{let i=r[t].dims.join(",");n.push(`${o};${i}`);break}default:throw new Error(`unsupported input dependency: ${e[t]}`)}}return n.join("|")},TD=(r,e,n)=>{let t=r.name;return r.shaderCache?.hint&&(t+="["+r.shaderCache.hint+"]"),t+=":"+n+`:${xD(e,r.shaderCache?.inputDependencies??new Array(e.length).fill("dims"))}`,t},Hc=class{constructor(e){e&&(this.architecture=e.architecture,this.vendor=e.vendor)}isArchitecture(e){return this.architecture===e}isVendor(e){return this.vendor===e}},qc=class{constructor(){this.currentSessionId=null;this.currentKernelId=null;this.commandEncoder=null;this.computePassEncoder=null;this.maxDispatchNumber=16;this.pendingDispatchNumber=0;this.pendingKernels=[];this.pendingQueries=new Map;this.sessionStatus="default";this.capturedCommandList=new Map;this.capturedPendingKernels=new Map;this.sessionExternalDataMapping=new Map}get currentKernelCustomData(){if(this.currentKernelId===null)throw new Error("currentKernelCustomData(): currentKernelId is null. (should not happen)");let e=this.kernelCustomData.get(this.currentKernelId);return e||(e={},this.kernelCustomData.set(this.currentKernelId,e)),e}async initialize(e,n){this.env=e;let t=[],o={requiredLimits:{maxComputeWorkgroupStorageSize:n.limits.maxComputeWorkgroupStorageSize,maxComputeWorkgroupsPerDimension:n.limits.maxComputeWorkgroupsPerDimension,maxStorageBufferBindingSize:n.limits.maxStorageBufferBindingSize,maxBufferSize:n.limits.maxBufferSize,maxComputeInvocationsPerWorkgroup:n.limits.maxComputeInvocationsPerWorkgroup,maxComputeWorkgroupSizeX:n.limits.maxComputeWorkgroupSizeX,maxComputeWorkgroupSizeY:n.limits.maxComputeWorkgroupSizeY,maxComputeWorkgroupSizeZ:n.limits.maxComputeWorkgroupSizeZ},requiredFeatures:t},i=u=>n.features.has(u)&&t.push(u)&&!0;i("chromium-experimental-timestamp-query-inside-passes")||i("timestamp-query"),i("shader-f16"),i("subgroups"),this.device=await n.requestDevice(o);let a=n,s=n.info??(typeof a.requestAdapterInfo=="function"?await a.requestAdapterInfo():void 0);this.adapterInfo=new Hc(s),this.gpuDataManager=D_(this),this.programManager=new rs(this),this.kernels=new Map,this.kernelPersistentData=new Map,this.kernelCustomData=new Map,Da(e.logLevel,!!e.debug),this.device.onuncapturederror=u=>{u.error instanceof GPUValidationError&&console.error(`An uncaught WebGPU validation error was raised: ${u.error.message}`)},Object.defineProperty(this.env.webgpu,"device",{value:this.device,writable:!1,enumerable:!0,configurable:!0}),Object.defineProperty(this.env.webgpu,"adapter",{value:n,writable:!1,enumerable:!0,configurable:!1}),this.setQueryType()}dispose(){typeof this.querySet<"u"&&this.querySet.destroy(),this.gpuDataManager.dispose(),this.device&&this.env?.webgpu&&this.device.lost.then(()=>{delete this.env.webgpu.device})}getCommandEncoder(){return this.commandEncoder||(this.commandEncoder=this.device.createCommandEncoder()),this.commandEncoder}getComputePassEncoder(){if(!this.computePassEncoder){let e=this.getCommandEncoder(),n={};this.queryType==="at-passes"&&(n.timestampWrites={querySet:this.querySet,beginningOfPassWriteIndex:this.pendingDispatchNumber*2,endOfPassWriteIndex:this.pendingDispatchNumber*2+1}),this.computePassEncoder=e.beginComputePass(n)}return this.computePassEncoder}endComputePass(){this.computePassEncoder&&(this.computePassEncoder.end(),this.computePassEncoder=null)}flush(){if(!this.commandEncoder)return;At(),this.endComputePass();let e;this.queryType!=="none"&&(this.commandEncoder.resolveQuerySet(this.querySet,0,this.pendingDispatchNumber*2,this.queryResolveBuffer,0),e=this.device.createBuffer({size:this.pendingDispatchNumber*2*8,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),this.pendingQueries.set(e,this.pendingKernels),this.pendingKernels=[],this.commandEncoder.copyBufferToBuffer(this.queryResolveBuffer,0,e,0,this.pendingDispatchNumber*2*8)),this.device.queue.submit([this.commandEncoder.finish()]),this.gpuDataManager.refreshPendingBuffers(),this.commandEncoder=null,this.pendingDispatchNumber=0,this.queryType!=="none"&&e.mapAsync(GPUMapMode.READ).then(()=>{let n=new BigUint64Array(e.getMappedRange()),t=this.pendingQueries.get(e);for(let o=0;o<n.length/2;o++){let i=t[o],a=i.kernelId,s=this.kernels.get(a),u=s.kernelType,l=s.kernelName,d=i.programName,p=i.inputTensorViews,h=i.outputTensorViews,g=n[o*2],b=n[o*2+1];typeof this.queryTimeBase>"u"&&(this.queryTimeBase=g);let _=Number(g-this.queryTimeBase),S=Number(b-this.queryTimeBase);if(!Number.isSafeInteger(_)||!Number.isSafeInteger(S))throw new RangeError("incorrect timestamp range");if(this.env.webgpu.profiling?.ondata)this.env.webgpu.profiling.ondata({version:1,inputsMetadata:p.map(v=>({dims:v.dims,dataType:Gn(v.dataType)})),outputsMetadata:h.map(v=>({dims:v.dims,dataType:Gn(v.dataType)})),kernelId:a,kernelType:u,kernelName:l,programName:d,startTime:_,endTime:S});else{let v="";p.forEach(($,O)=>{v+=`input[${O}]: [${$.dims}] | ${Gn($.dataType)}, `});let x="";h.forEach(($,O)=>{x+=`output[${O}]: [${$.dims}] | ${Gn($.dataType)}, `}),console.log(`[profiling] kernel "${a}|${u}|${l}|${d}" ${v}${x}start time: ${_} ns, execution time: ${S-_} ns`)}fi("GPU",`${d}::${g}::${b}`)}e.unmap(),this.pendingQueries.delete(e)}),_t()}run(e,n,t,o,i,a){At(e.name);let s=[];for(let $=0;$<n.length;++$){let O=n[$].data;if(O===0)continue;let E=this.gpuDataManager.get(O);if(!E)throw new Error(`no GPU data for input: ${O}`);s.push(E)}let{outputs:u,dispatchGroup:l,programUniforms:d}=e.getRunData(n),p=t.length===0?u.map(($,O)=>O):t;if(p.length!==u.length)throw new Error(`Output size ${p.length} must be equal to ${u.length}.`);let h=[],g=[];for(let $=0;$<u.length;++$){if(!Number.isInteger(p[$])||p[$]<-3||p[$]>=a)throw new Error(`Invalid output index: ${p[$]}`);if(p[$]===-3)continue;let O=p[$]===-1,E=p[$]===-2,D=O||E?i(u[$].dataType,u[$].dims):o(p[$],u[$].dataType,u[$].dims);if(h.push(D),D.data===0)continue;let B=this.gpuDataManager.get(D.data);if(!B)throw new Error(`no GPU data for output: ${D.data}`);if(O&&this.temporaryData.push(B),E){let T=this.kernelPersistentData.get(this.currentKernelId);T||(T=[],this.kernelPersistentData.set(this.currentKernelId,T)),T.push(B)}g.push(B)}if(s.length!==n.length||g.length!==h.length){if(g.length===0)return _t(e.name),h;throw new Error(`Program ${e.name} has zero-sized tensor(s) in inputs or outputs. This is not supported now.`)}let b;if(d){let $=0,O=[];d.forEach(T=>{let F=typeof T.data=="number"?[T.data]:T.data;if(F.length===0)return;let W=T.type===10?2:4,z,te;T.type===10?(te=F.length>4?16:F.length>2?8:F.length*W,z=F.length>4?16:W*F.length):(te=F.length<=2?F.length*W:16,z=16),$=Math.ceil($/te)*te,O.push($);let V=T.type===10?8:4;$+=F.length>4?Math.ceil(F.length/V)*z:F.length*W});let E=16;$=Math.ceil($/E)*E;let D=new ArrayBuffer($);d.forEach((T,F)=>{let W=O[F],z=typeof T.data=="number"?[T.data]:T.data;if(T.type===6)new Int32Array(D,W,z.length).set(z);else if(T.type===12)new Uint32Array(D,W,z.length).set(z);else if(T.type===10)new Uint16Array(D,W,z.length).set(z);else if(T.type===1)new Float32Array(D,W,z.length).set(z);else throw new Error(`Unsupported uniform type: ${Gn(T.type)}`)});let B=this.gpuDataManager.create($,GPUBufferUsage.COPY_DST|GPUBufferUsage.UNIFORM);this.device.queue.writeBuffer(B.buffer,0,D,0,$),this.gpuDataManager.release(B.id),b={offset:0,size:$,buffer:B.buffer}}let _=this.programManager.normalizeDispatchGroupSize(l),S=_[1]===1&&_[2]===1,v=TD(e,n,S),x=this.programManager.getArtifact(v);if(x||(x=this.programManager.build(e,_),this.programManager.setArtifact(v,x),_e("info",()=>`[artifact] key: ${v}, programName: ${e.name}`)),d&&x.uniformVariablesInfo){if(d.length!==x.uniformVariablesInfo.length)throw new Error(`Uniform variables count mismatch: expect ${x.uniformVariablesInfo.length}, got ${d.length} in program "${x.programInfo.name}".`);for(let $=0;$<d.length;$++){let O=d[$],E=O.type,D=typeof O.data=="number"?1:O.data.length,[B,T]=x.uniformVariablesInfo[$];if(E!==B||D!==T)throw new Error(`Uniform variable ${$} mismatch: expect type ${B} with size ${T}, got type ${E} with size ${D} in program "${x.programInfo.name}".`)}}if(_e("info",()=>`[ProgramManager] run "${e.name}" (key=${v}) with ${_[0]}x${_[1]}x${_[2]}`),this.queryType!=="none"||this.sessionStatus==="capturing"){let $={kernelId:this.currentKernelId,programName:x.programInfo.name,inputTensorViews:n,outputTensorViews:h};this.pendingKernels.push($),this.sessionStatus==="capturing"&&this.capturedPendingKernels.get(this.currentSessionId).push($)}return this.programManager.run(x,s,g,_,b),_t(e.name),h}upload(e,n){this.gpuDataManager.upload(e,n)}memcpy(e,n){this.gpuDataManager.memcpy(e,n)}async download(e,n){await this.gpuDataManager.download(e,n)}alloc(e){return this.gpuDataManager.create(e).id}free(e){return this.gpuDataManager.release(e)}createKernel(e,n,t,o){let i=Ox.get(e);if(!i)throw new Error(`kernel not implemented: ${e}`);let a={kernelType:e,kernelName:o,kernelEntry:i[0],attributes:[i[1],t]};this.kernels.set(n,a)}releaseKernel(e){let n=this.kernelPersistentData.get(e);if(n){for(let t of n)this.gpuDataManager.release(t.id);this.kernelPersistentData.delete(e)}this.kernelCustomData.delete(e),this.kernels.delete(e)}computeKernel(e,n,t){let o=this.kernels.get(e);if(!o)throw new Error(`kernel not created: ${e}`);let i=o.kernelType,a=o.kernelName,s=o.kernelEntry,u=o.attributes;if(this.currentKernelId!==null)throw new Error(`kernel "[${i}] ${a}" is not allowed to be called recursively`);this.currentKernelId=e,u[0]&&(u[1]=u[0](u[1]),u[0]=void 0),_e("info",()=>`[WebGPU] Start to run kernel "[${i}] ${a}"...`);let l=this.env.debug;this.temporaryData=[];try{return l&&this.device.pushErrorScope("validation"),s(n,u[1]),0}catch(d){return t.push(Promise.resolve(`[WebGPU] Kernel "[${i}] ${a}" failed. ${d}`)),1}finally{l&&t.push(this.device.popErrorScope().then(d=>d?`GPU validation error for kernel "[${i}] ${a}": ${d.message}`:null));for(let d of this.temporaryData)this.gpuDataManager.release(d.id);this.temporaryData=[],this.currentKernelId=null}}registerBuffer(e,n,t,o){let i=this.sessionExternalDataMapping.get(e);i||(i=new Map,this.sessionExternalDataMapping.set(e,i));let a=i.get(n),s=this.gpuDataManager.registerExternalBuffer(t,o,a);return i.set(n,[s,t]),s}unregisterBuffers(e){let n=this.sessionExternalDataMapping.get(e);n&&(n.forEach(t=>this.gpuDataManager.unregisterExternalBuffer(t[0])),this.sessionExternalDataMapping.delete(e))}getBuffer(e){let n=this.gpuDataManager.get(e);if(!n)throw new Error(`no GPU data for buffer: ${e}`);return n.buffer}createDownloader(e,n,t){return async()=>{let o=await xc(this,e,n);return Na(o.buffer,t)}}writeTimestamp(e){this.queryType==="inside-passes"&&this.computePassEncoder.writeTimestamp(this.querySet,e)}setQueryType(){this.queryType="none",(this.env.webgpu.profiling?.mode==="default"||(typeof this.env.trace>"u"?this.env.wasm.trace:this.env.trace))&&(this.device.features.has("chromium-experimental-timestamp-query-inside-passes")?this.queryType="inside-passes":this.device.features.has("timestamp-query")&&(this.queryType="at-passes"),this.queryType!=="none"&&typeof this.querySet>"u"&&(this.querySet=this.device.createQuerySet({type:"timestamp",count:this.maxDispatchNumber*2}),this.queryResolveBuffer=this.device.createBuffer({size:this.maxDispatchNumber*2*8,usage:GPUBufferUsage.COPY_SRC|GPUBufferUsage.QUERY_RESOLVE})))}captureBegin(){_e("info","captureBegin"),this.capturedCommandList.get(this.currentSessionId)||this.capturedCommandList.set(this.currentSessionId,[]),this.capturedPendingKernels.get(this.currentSessionId)||this.capturedPendingKernels.set(this.currentSessionId,[]),this.flush(),this.sessionStatus="capturing"}captureEnd(){_e("info","captureEnd"),this.flush(),this.sessionStatus="default"}replay(){_e("info","replay"),this.sessionStatus="replaying";let e=this.capturedCommandList.get(this.currentSessionId),n=this.capturedPendingKernels.get(this.currentSessionId),t=e.length;this.pendingKernels=[];for(let o=0;o<t;o++){let i=this.getComputePassEncoder(),a=e[o];this.writeTimestamp(this.pendingDispatchNumber*2),i.setPipeline(a.computePipeline),i.setBindGroup(0,a.bindGroup),i.dispatchWorkgroups(...a.dispatchGroup),this.writeTimestamp(this.pendingDispatchNumber*2+1),this.pendingDispatchNumber++,this.queryType!=="none"&&this.pendingKernels.push(n[o]),(this.pendingDispatchNumber>=this.maxDispatchNumber||this.queryType==="at-passes")&&this.endComputePass(),this.pendingDispatchNumber>=this.maxDispatchNumber&&this.flush()}this.flush(),this.sessionStatus="default"}onCreateSession(){this.gpuDataManager.onCreateSession()}onReleaseSession(e){this.unregisterBuffers(e),this.capturedCommandList.has(e)&&this.capturedCommandList.delete(e),this.capturedPendingKernels.has(e)&&this.capturedPendingKernels.delete(e),this.gpuDataManager.onReleaseSession(e)}onRunStart(e){this.currentSessionId=e,this.setQueryType()}}});var kx={};Ir(kx,{init:()=>ID});var Xo,jc,ID,Nx=L(()=>{"use strict";ce();Un();me();O_();Xo=class r{constructor(e,n,t,o){this.module=e;this.dataType=n;this.data=t;this.dims=o}getFloat32Array(){if(this.dataType!==1)throw new Error("Invalid data type");let e=k.size(this.dims);return e===0?new Float32Array:new Float32Array(this.module.HEAP8.buffer,this.data,e)}getBigInt64Array(){if(this.dataType!==7)throw new Error("Invalid data type");let e=k.size(this.dims);return e===0?new BigInt64Array:new BigInt64Array(this.module.HEAP8.buffer,this.data,e)}getInt32Array(){if(this.dataType!==6)throw new Error("Invalid data type");let e=k.size(this.dims);return e===0?new Int32Array:new Int32Array(this.module.HEAP8.buffer,this.data,e)}getUint16Array(){if(this.dataType!==10&&this.dataType!==4)throw new Error("Invalid data type");let e=k.size(this.dims);return e===0?new Uint16Array:new Uint16Array(this.module.HEAP8.buffer,this.data,e)}reshape(e){if(k.size(e)!==k.size(this.dims))throw new Error("Invalid new shape");return new r(this.module,this.dataType,this.data,e)}},jc=class{constructor(e,n,t){this.module=e;this.backend=n;this.customDataOffset=0;this.customDataSize=0;this.adapterInfo=n.adapterInfo;let o=e.PTR_SIZE,i=t/e.PTR_SIZE,a=o===4?"i32":"i64";this.opKernelContext=Number(e.getValue(o*i++,a));let s=Number(e.getValue(o*i++,a));this.outputCount=Number(e.getValue(o*i++,a)),this.customDataOffset=Number(e.getValue(o*i++,"*")),this.customDataSize=Number(e.getValue(o*i++,a));let u=[];for(let l=0;l<s;l++){let d=Number(e.getValue(o*i++,a)),p=Number(e.getValue(o*i++,"*")),h=Number(e.getValue(o*i++,a)),g=[];for(let b=0;b<h;b++)g.push(Number(e.getValue(o*i++,a)));u.push(new Xo(e,d,p,g))}this.inputs=u}get kernelCustomData(){return this.backend.currentKernelCustomData}get customDataBuffer(){return this.module.HEAPU8.subarray(this.customDataOffset,this.customDataOffset+this.customDataSize)}compute(e,n){let t=n?.inputs?.map(s=>typeof s=="number"?this.inputs[s]:s)??this.inputs,o=n?.outputs??[],i=(s,u,l)=>new Xo(this.module,u,this.output(s,l),l),a=(s,u)=>{let l=yr(s,u);if(!l)throw new Error(`Unsupported data type: ${s}`);let d=l>0?this.backend.gpuDataManager.create(l).id:0;return new Xo(this.module,s,d,u)};return this.backend.run(e,t,o,i,a,this.outputCount)}output(e,n){let t=this.module.stackSave();try{let o=this.module.PTR_SIZE,i=o===4?"i32":"i64",a=this.module.stackAlloc((1+n.length)*o);this.module.setValue(a,n.length,i);for(let s=0;s<n.length;s++)this.module.setValue(a+o*(s+1),n[s],i);return this.module._JsepOutput(this.opKernelContext,e,a)}catch(o){throw new Error(`Failed to generate kernel's output[${e}] with dims [${n}]. If you are running with pre-allocated output, please make sure the output type/dims are correct. Error: ${o}`)}finally{this.module.stackRestore(t)}}},ID=async(r,e,n,t)=>{let o=e.jsepInit;if(!o)throw new Error("Failed to initialize JSEP. The WebAssembly module is not built with JSEP support.");if(r==="webgpu"){let i=(Dx(),Kr(Cx)).WebGpuBackend,a=new i;await a.initialize(n,t),o("webgpu",[a,s=>a.alloc(Number(s)),s=>a.free(s),(s,u,l,d=!1)=>{if(d)_e("verbose",()=>`[WebGPU] jsepCopyGpuToGpu: src=${Number(s)}, dst=${Number(u)}, size=${Number(l)}`),a.memcpy(Number(s),Number(u));else{_e("verbose",()=>`[WebGPU] jsepCopyCpuToGpu: dataOffset=${Number(s)}, gpuDataId=${Number(u)}, size=${Number(l)}`);let p=e.HEAPU8.subarray(Number(s>>>0),Number(s>>>0)+Number(l));a.upload(Number(u),p)}},async(s,u,l)=>{_e("verbose",()=>`[WebGPU] jsepCopyGpuToCpu: gpuDataId=${s}, dataOffset=${u}, size=${l}`),await a.download(Number(s),()=>e.HEAPU8.subarray(Number(u)>>>0,Number(u+l)>>>0))},(s,u,l)=>a.createKernel(s,Number(u),l,e.UTF8ToString(e._JsepGetNodeName(Number(u)))),s=>a.releaseKernel(s),(s,u,l,d)=>{_e("verbose",()=>`[WebGPU] jsepRun: sessionHandle=${l}, kernel=${s}, contextDataOffset=${u}`);let p=new jc(e,a,Number(u));return a.computeKernel(Number(s),p,d)},()=>a.captureBegin(),()=>a.captureEnd(),()=>a.replay()])}else{let i=new Ma(n);o("webnn",[i,()=>i.reserveTensorId(),a=>i.releaseTensorId(a),async(a,s,u,l,d)=>i.ensureTensor(a,s,u,l,d),(a,s)=>{i.uploadTensor(a,s)},async(a,s)=>i.downloadTensor(a,s),(a,s)=>i.registerMLContext(a,s),!!n.trace])}}});var SD,va,xa,Fr,$D,Lx,Go,Ta,Ia,Rx,Sa,$a,Aa,uc=L(()=>{"use strict";ht();m_();b_();ce();gr();Pa();hc();SD=(r,e)=>{Ve()._OrtInit(r,e)!==0&&Ee("Can't initialize onnxruntime.")},va=async r=>{SD(r.wasm.numThreads,Fo(r.logLevel))},xa=async(r,e)=>{Ve().asyncInit?.();let n=r.webgpu.adapter;if(e==="webgpu"){if(typeof navigator>"u"||!navigator.gpu)throw new Error("WebGPU is not supported in current environment");if(n){if(typeof n.limits!="object"||typeof n.features!="object"||typeof n.requestDevice!="function")throw new Error("Invalid GPU adapter set in `env.webgpu.adapter`. It must be a GPUAdapter object.")}else{let t=r.webgpu.powerPreference;if(t!==void 0&&t!=="low-power"&&t!=="high-performance")throw new Error(`Invalid powerPreference setting: "${t}"`);let o=r.webgpu.forceFallbackAdapter;if(o!==void 0&&typeof o!="boolean")throw new Error(`Invalid forceFallbackAdapter setting: "${o}"`);if(n=await navigator.gpu.requestAdapter({powerPreference:t,forceFallbackAdapter:o}),!n)throw new Error('Failed to get GPU adapter. You may need to enable flag "--enable-unsafe-webgpu" if you are using Chrome.')}}if(e==="webnn"&&(typeof navigator>"u"||!navigator.ml))throw new Error("WebNN is not supported in current environment");{let t=(Nx(),Kr(kx)).init;e==="webgpu"&&await t("webgpu",Ve(),r,n),e==="webnn"&&await t("webnn",Ve(),r)}},Fr=new Map,$D=r=>{let e=Ve(),n=e.stackSave();try{let t=e.PTR_SIZE,o=e.stackAlloc(2*t);e._OrtGetInputOutputCount(r,o,o+t)!==0&&Ee("Can't get session input/output count.");let a=t===4?"i32":"i64";return[Number(e.getValue(o,a)),Number(e.getValue(o+t,a))]}finally{e.stackRestore(n)}},Lx=(r,e)=>{let n=Ve(),t=n.stackSave(),o=0;try{let i=n.PTR_SIZE,a=n.stackAlloc(2*i);n._OrtGetInputOutputMetadata(r,e,a,a+i)!==0&&Ee("Can't get session input/output metadata.");let u=Number(n.getValue(a,"*"));o=Number(n.getValue(a+i,"*"));let l=n.HEAP32[o/4];if(l===0)return[u,0];let d=n.HEAPU32[o/4+1],p=[];for(let h=0;h<d;h++){let g=Number(n.getValue(o+8+h*i,"*"));p.push(g!==0?n.UTF8ToString(g):Number(n.getValue(o+8+(h+d)*i,"*")))}return[u,l,p]}finally{n.stackRestore(t),o!==0&&n._OrtFree(o)}},Go=r=>{let e=Ve(),n=e._malloc(r.byteLength);if(n===0)throw new Error(`Can't create a session. failed to allocate a buffer of size ${r.byteLength}.`);return e.HEAPU8.set(r,n),[n,r.byteLength]},Ta=async(r,e)=>{let n,t,o=Ve();Array.isArray(r)?[n,t]=r:r.buffer===o.HEAPU8.buffer?[n,t]=[r.byteOffset,r.byteLength]:[n,t]=Go(r);let i=0,a=0,s=0,u=[],l=[],d=[];try{if([a,u]=await g_(e),e?.externalData&&o.mountExternalData){let O=[];for(let E of e.externalData){let D=typeof E=="string"?E:E.path;O.push(Wo(typeof E=="string"?E:E.data).then(B=>{o.mountExternalData(D,B)}))}await Promise.all(O)}for(let O of e?.executionProviders??[])if((typeof O=="string"?O:O.name)==="webnn"){if(o.shouldTransferToMLTensor=!1,typeof O!="string"){let D=O,B=D?.context,T=D?.gpuDevice,F=D?.deviceType,W=D?.powerPreference;B?o.currentContext=B:T?o.currentContext=await o.webnnCreateMLContext(T):o.currentContext=await o.webnnCreateMLContext({deviceType:F,powerPreference:W})}else o.currentContext=await o.webnnCreateMLContext();break}i=await o._OrtCreateSession(n,t,a),o.webgpuOnCreateSession?.(i),i===0&&Ee("Can't create a session."),o.jsepOnCreateSession?.(),o.currentContext&&(o.webnnRegisterMLContext(i,o.currentContext),o.currentContext=void 0,o.shouldTransferToMLTensor=!0);let[p,h]=$D(i),g=!!e?.enableGraphCapture,b=[],_=[],S=[],v=[],x=[];for(let O=0;O<p;O++){let[E,D,B]=Lx(i,O);E===0&&Ee("Can't get an input name."),l.push(E);let T=o.UTF8ToString(E);b.push(T),S.push(D===0?{name:T,isTensor:!1}:{name:T,isTensor:!0,type:Gn(D),shape:B})}for(let O=0;O<h;O++){let[E,D,B]=Lx(i,O+p);E===0&&Ee("Can't get an output name."),d.push(E);let T=o.UTF8ToString(E);_.push(T),v.push(D===0?{name:T,isTensor:!1}:{name:T,isTensor:!0,type:Gn(D),shape:B});{if(g&&e?.preferredOutputLocation===void 0){x.push("gpu-buffer");continue}let F=typeof e?.preferredOutputLocation=="string"?e.preferredOutputLocation:e?.preferredOutputLocation?.[T]??"cpu",W=o.webnnIsGraphOutput;if(F==="cpu"&&W&&W(i,T)){x.push("ml-tensor-cpu-output");continue}if(F!=="cpu"&&F!=="cpu-pinned"&&F!=="gpu-buffer"&&F!=="ml-tensor")throw new Error(`Not supported preferred output location: ${F}.`);if(g&&F!=="gpu-buffer")throw new Error(`Not supported preferred output location: ${F}. Only 'gpu-buffer' location is supported when enableGraphCapture is true.`);x.push(F)}}let $=null;return x.some(O=>O==="gpu-buffer"||O==="ml-tensor"||O==="ml-tensor-cpu-output")&&(s=o._OrtCreateBinding(i),s===0&&Ee("Can't create IO binding."),$={handle:s,outputPreferredLocations:x,outputPreferredLocationsEncoded:x.map(O=>O==="ml-tensor-cpu-output"?"ml-tensor":O).map(O=>fc(O))}),Fr.set(i,[i,l,d,$,g,!1]),[i,b,_,S,v]}catch(p){throw l.forEach(h=>o._OrtFree(h)),d.forEach(h=>o._OrtFree(h)),s!==0&&o._OrtReleaseBinding(s)!==0&&Ee("Can't release IO binding."),i!==0&&o._OrtReleaseSession(i)!==0&&Ee("Can't release session."),p}finally{o._free(n),a!==0&&o._OrtReleaseSessionOptions(a)!==0&&Ee("Can't release session options."),u.forEach(p=>o._free(p)),o.unmountExternalData?.()}},Ia=r=>{let e=Ve(),n=Fr.get(r);if(!n)throw new Error(`cannot release session. invalid session id: ${r}`);let[t,o,i,a,s]=n;a&&(s&&e._OrtClearBoundOutputs(a.handle)!==0&&Ee("Can't clear bound outputs."),e._OrtReleaseBinding(a.handle)!==0&&Ee("Can't release IO binding.")),e.jsepOnReleaseSession?.(r),e.webnnOnReleaseSession?.(r),e.webgpuOnReleaseSession?.(r),o.forEach(u=>e._OrtFree(u)),i.forEach(u=>e._OrtFree(u)),e._OrtReleaseSession(t)!==0&&Ee("Can't release session."),Fr.delete(r)},Rx=async(r,e,n,t,o,i,a=!1)=>{if(!r){e.push(0);return}let s=Ve(),u=s.PTR_SIZE,l=r[0],d=r[1],p=r[3],h=p,g,b;if(l==="string"&&(p==="gpu-buffer"||p==="ml-tensor"))throw new Error("String tensor is not supported on GPU.");if(a&&p!=="gpu-buffer")throw new Error(`External buffer must be provided for input/output index ${i} when enableGraphCapture is true.`);if(p==="gpu-buffer"){let v=r[2].gpuBuffer;b=yr(br(l),d);{let x=s.jsepRegisterBuffer;if(!x)throw new Error('Tensor location "gpu-buffer" is not supported without using WebGPU.');g=x(t,i,v,b)}}else if(p==="ml-tensor"){let v=r[2].mlTensor;b=yr(br(l),d);let x=s.webnnRegisterMLTensor;if(!x)throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');g=x(t,v,br(l),d)}else{let v=r[2];if(Array.isArray(v)){b=u*v.length,g=s._malloc(b),n.push(g);for(let x=0;x<v.length;x++){if(typeof v[x]!="string")throw new TypeError(`tensor data at index ${x} is not a string`);s.setValue(g+x*u,Et(v[x],n),"*")}}else{let x=s.webnnIsGraphInput,$=s.webnnIsGraphOutput;if(l!=="string"&&x&&$){let O=s.UTF8ToString(o);if(x(t,O)||$(t,O)){let E=br(l);b=yr(E,d),h="ml-tensor";let D=s.webnnCreateTemporaryTensor,B=s.webnnUploadTensor;if(!D||!B)throw new Error('Tensor location "ml-tensor" is not supported without using WebNN.');let T=await D(t,E,d);B(T,new Uint8Array(v.buffer,v.byteOffset,v.byteLength)),g=T}else b=v.byteLength,g=s._malloc(b),n.push(g),s.HEAPU8.set(new Uint8Array(v.buffer,v.byteOffset,b),g)}else b=v.byteLength,g=s._malloc(b),n.push(g),s.HEAPU8.set(new Uint8Array(v.buffer,v.byteOffset,b),g)}}let _=s.stackSave(),S=s.stackAlloc(4*d.length);try{d.forEach((x,$)=>s.setValue(S+$*u,x,u===4?"i32":"i64"));let v=s._OrtCreateTensor(br(l),g,b,S,d.length,fc(h));v===0&&Ee(`Can't create tensor for input/output. session=${t}, index=${i}.`),e.push(v)}finally{s.stackRestore(_)}},Sa=async(r,e,n,t,o,i)=>{let a=Ve(),s=a.PTR_SIZE,u=Fr.get(r);if(!u)throw new Error(`cannot run inference. invalid session id: ${r}`);let l=u[0],d=u[1],p=u[2],h=u[3],g=u[4],b=u[5],_=e.length,S=t.length,v=0,x=[],$=[],O=[],E=[],D=[],B=a.stackSave(),T=a.stackAlloc(_*s),F=a.stackAlloc(_*s),W=a.stackAlloc(S*s),z=a.stackAlloc(S*s);try{[v,x]=h_(i),sr("wasm prepareInputOutputTensor");for(let R=0;R<_;R++)await Rx(n[R],$,E,r,d[e[R]],e[R],g);for(let R=0;R<S;R++)await Rx(o[R],O,E,r,p[t[R]],_+t[R],g);ur("wasm prepareInputOutputTensor");for(let R=0;R<_;R++)a.setValue(T+R*s,$[R],"*"),a.setValue(F+R*s,d[e[R]],"*");for(let R=0;R<S;R++)a.setValue(W+R*s,O[R],"*"),a.setValue(z+R*s,p[t[R]],"*");if(h&&!b){let{handle:R,outputPreferredLocations:j,outputPreferredLocationsEncoded:J}=h;if(d.length!==_)throw new Error(`input count from feeds (${_}) is expected to be always equal to model's input count (${d.length}).`);sr("wasm bindInputsOutputs");for(let Z=0;Z<_;Z++){let oe=e[Z];await a._OrtBindInput(R,d[oe],$[Z])!==0&&Ee(`Can't bind input[${Z}] for session=${r}.`)}for(let Z=0;Z<S;Z++){let oe=t[Z];o[Z]?.[3]?(D.push(O[Z]),a._OrtBindOutput(R,p[oe],O[Z],0)!==0&&Ee(`Can't bind pre-allocated output[${Z}] for session=${r}.`)):a._OrtBindOutput(R,p[oe],0,J[oe])!==0&&Ee(`Can't bind output[${Z}] to ${j[Z]} for session=${r}.`)}ur("wasm bindInputsOutputs"),Fr.set(r,[l,d,p,h,g,!0])}a.jsepOnRunStart?.(l),a.webnnOnRunStart?.(l);let te;h?te=await a._OrtRunWithBinding(l,h.handle,S,W,v):te=await a._OrtRun(l,F,T,_,z,S,W,v),te!==0&&Ee("failed to call OrtRun().");let V=[],w=[];sr("wasm ProcessOutputTensor");for(let R=0;R<S;R++){let j=Number(a.getValue(W+R*s,"*"));if(j===O[R]||D.includes(O[R])){V.push(o[R]),j!==O[R]&&a._OrtReleaseTensor(j)!==0&&Ee("Can't release tensor.");continue}let J=a.stackSave(),Z=a.stackAlloc(4*s),oe=!1,se,pe=0;try{a._OrtGetTensorData(j,Z,Z+s,Z+2*s,Z+3*s)!==0&&Ee(`Can't access output tensor data on index ${R}.`);let fe=s===4?"i32":"i64",U=Number(a.getValue(Z,fe));pe=a.getValue(Z+s,"*");let q=a.getValue(Z+s*2,"*"),ye=Number(a.getValue(Z+s*3,fe)),Je=[];for(let ke=0;ke<ye;ke++)Je.push(Number(a.getValue(q+ke*s,fe)));a._OrtFree(q)!==0&&Ee("Can't free memory for tensor dims.");let Fe=Je.reduce((ke,je)=>ke*je,1);se=Gn(U);let st=h?.outputPreferredLocations[t[R]];if(se==="string"){if(st==="gpu-buffer"||st==="ml-tensor")throw new Error("String tensor is not supported on GPU.");let ke=[];for(let je=0;je<Fe;je++){let Wt=a.getValue(pe+je*s,"*"),St=a.getValue(pe+(je+1)*s,"*"),qe=je===Fe-1?void 0:St-Wt;ke.push(a.UTF8ToString(Wt,qe))}V.push([se,Je,ke,"cpu"])}else if(st==="gpu-buffer"&&Fe>0){let ke=a.jsepGetBuffer;if(!ke)throw new Error('preferredLocation "gpu-buffer" is not supported without using WebGPU.');let je=ke(pe),Wt=yr(U,Fe);if(Wt===void 0||!Ea(se))throw new Error(`Unsupported data type: ${se}`);oe=!0,V.push([se,Je,{gpuBuffer:je,download:a.jsepCreateDownloader(je,Wt,se),dispose:()=>{a._OrtReleaseTensor(j)!==0&&Ee("Can't release tensor.")}},"gpu-buffer"])}else if(st==="ml-tensor"&&Fe>0){let ke=a.webnnEnsureTensor,je=a.webnnIsGraphInputOutputTypeSupported;if(!ke||!je)throw new Error('preferredLocation "ml-tensor" is not supported without using WebNN.');if(yr(U,Fe)===void 0||!Ca(se))throw new Error(`Unsupported data type: ${se}`);if(!je(r,se,!1))throw new Error(`preferredLocation "ml-tensor" for ${se} output is not supported by current WebNN Context.`);let St=await ke(r,pe,U,Je,!1);oe=!0,V.push([se,Je,{mlTensor:St,download:a.webnnCreateMLTensorDownloader(pe,se),dispose:()=>{a.webnnReleaseTensorId(pe),a._OrtReleaseTensor(j)}},"ml-tensor"])}else if(st==="ml-tensor-cpu-output"&&Fe>0){let ke=a.webnnCreateMLTensorDownloader(pe,se)(),je=V.length;oe=!0,w.push((async()=>{let Wt=[je,await ke];return a.webnnReleaseTensorId(pe),a._OrtReleaseTensor(j),Wt})()),V.push([se,Je,[],"cpu"])}else{let ke=lo(se),je=new ke(Fe);new Uint8Array(je.buffer,je.byteOffset,je.byteLength).set(a.HEAPU8.subarray(pe,pe+je.byteLength)),V.push([se,Je,je,"cpu"])}}finally{a.stackRestore(J),se==="string"&&pe&&a._free(pe),oe||a._OrtReleaseTensor(j)}}h&&!g&&(a._OrtClearBoundOutputs(h.handle)!==0&&Ee("Can't clear bound outputs."),Fr.set(r,[l,d,p,h,g,!1]));for(let[R,j]of await Promise.all(w))V[R][2]=j;return ur("wasm ProcessOutputTensor"),V}finally{a.webnnOnRunEnd?.(l),a.stackRestore(B),$.forEach(te=>a._OrtReleaseTensor(te)),O.forEach(te=>a._OrtReleaseTensor(te)),E.forEach(te=>a._free(te)),v!==0&&a._OrtReleaseRunOptions(v),x.forEach(te=>a._free(te))}},$a=r=>{let e=Ve(),n=Fr.get(r);if(!n)throw new Error("invalid session id");let t=n[0],o=e._OrtEndProfiling(t);o===0&&Ee("Can't get an profile file name."),e._OrtFree(o)},Aa=r=>{let e=[];for(let n of r){let t=n[2];!Array.isArray(t)&&"buffer"in t&&e.push(t.buffer)}return e}});var Wr,Ft,Zo,is,as,os,Kc,Xc,ho,mo,OD,zx,Mx,Bx,Vx,Gx,Ux,Fx,Zc=L(()=>{"use strict";ht();uc();gr();_a();Wr=()=>!!he.wasm.proxy&&typeof document<"u",Zo=!1,is=!1,as=!1,Xc=new Map,ho=(r,e)=>{let n=Xc.get(r);n?n.push(e):Xc.set(r,[e])},mo=()=>{if(Zo||!is||as||!Ft)throw new Error("worker not ready")},OD=r=>{switch(r.data.type){case"init-wasm":Zo=!1,r.data.err?(as=!0,Kc[1](r.data.err)):(is=!0,Kc[0]()),os&&(URL.revokeObjectURL(os),os=void 0);break;case"init-ep":case"copy-from":case"create":case"release":case"run":case"end-profiling":{let e=Xc.get(r.data.type);r.data.err?e.shift()[1](r.data.err):e.shift()[0](r.data.out);break}default:}},zx=async()=>{if(!is){if(Zo)throw new Error("multiple calls to 'initWasm()' detected.");if(as)throw new Error("previous call to 'initWasm()' failed.");if(Zo=!0,Wr())return new Promise((r,e)=>{Ft?.terminate(),d_().then(([n,t])=>{try{Ft=t,Ft.onerror=i=>e(i),Ft.onmessage=OD,Kc=[r,e];let o={type:"init-wasm",in:he};!o.in.wasm.wasmPaths&&(n||cc)&&(o.in.wasm.wasmPaths={wasm:new URL("ort-wasm-simd-threaded.jsep.wasm",import.meta.url).href}),Ft.postMessage(o),os=n}catch(o){e(o)}},e)});try{await wa(he.wasm),await va(he),is=!0}catch(r){throw as=!0,r}finally{Zo=!1}}},Mx=async r=>{if(Wr())return mo(),new Promise((e,n)=>{ho("init-ep",[e,n]);let t={type:"init-ep",in:{epName:r,env:he}};Ft.postMessage(t)});await xa(he,r)},Bx=async r=>Wr()?(mo(),new Promise((e,n)=>{ho("copy-from",[e,n]);let t={type:"copy-from",in:{buffer:r}};Ft.postMessage(t,[r.buffer])})):Go(r),Vx=async(r,e)=>{if(Wr()){if(e?.preferredOutputLocation)throw new Error('session option "preferredOutputLocation" is not supported for proxy.');return mo(),new Promise((n,t)=>{ho("create",[n,t]);let o={type:"create",in:{model:r,options:{...e}}},i=[];r instanceof Uint8Array&&i.push(r.buffer),Ft.postMessage(o,i)})}else return Ta(r,e)},Gx=async r=>{if(Wr())return mo(),new Promise((e,n)=>{ho("release",[e,n]);let t={type:"release",in:r};Ft.postMessage(t)});Ia(r)},Ux=async(r,e,n,t,o,i)=>{if(Wr()){if(n.some(a=>a[3]!=="cpu"))throw new Error("input tensor on GPU is not supported for proxy.");if(o.some(a=>a))throw new Error("pre-allocated output tensor is not supported for proxy.");return mo(),new Promise((a,s)=>{ho("run",[a,s]);let u=n,l={type:"run",in:{sessionId:r,inputIndices:e,inputs:u,outputIndices:t,options:i}};Ft.postMessage(l,Aa(u))})}else return Sa(r,e,n,t,o,i)},Fx=async r=>{if(Wr())return mo(),new Promise((e,n)=>{ho("end-profiling",[e,n]);let t={type:"end-profiling",in:r};Ft.postMessage(t)});$a(r)}});var Wx,PD,ss,Hx=L(()=>{"use strict";ht();Zc();ce();ya();hc();Wx=(r,e)=>{switch(r.location){case"cpu":return[r.type,r.dims,r.data,"cpu"];case"gpu-buffer":return[r.type,r.dims,{gpuBuffer:r.gpuBuffer},"gpu-buffer"];case"ml-tensor":return[r.type,r.dims,{mlTensor:r.mlTensor},"ml-tensor"];default:throw new Error(`invalid data location: ${r.location} for ${e()}`)}},PD=r=>{switch(r[3]){case"cpu":return new $t(r[0],r[2],r[1]);case"gpu-buffer":{let e=r[0];if(!Ea(e))throw new Error(`not supported data type: ${e} for deserializing GPU tensor`);let{gpuBuffer:n,download:t,dispose:o}=r[2];return $t.fromGpuBuffer(n,{dataType:e,dims:r[1],download:t,dispose:o})}case"ml-tensor":{let e=r[0];if(!Ca(e))throw new Error(`not supported data type: ${e} for deserializing MLTensor tensor`);let{mlTensor:n,download:t,dispose:o}=r[2];return $t.fromMLTensor(n,{dataType:e,dims:r[1],download:t,dispose:o})}default:throw new Error(`invalid data location: ${r[3]}`)}},ss=class{async fetchModelAndCopyToWasmMemory(e){return Bx(await Wo(e))}async loadModel(e,n){At();let t;typeof e=="string"?t=await this.fetchModelAndCopyToWasmMemory(e):t=e,[this.sessionId,this.inputNames,this.outputNames,this.inputMetadata,this.outputMetadata]=await Vx(t,n),_t()}async dispose(){return Gx(this.sessionId)}async run(e,n,t){At();let o=[],i=[];Object.entries(e).forEach(h=>{let g=h[0],b=h[1],_=this.inputNames.indexOf(g);if(_===-1)throw new Error(`invalid input '${g}'`);o.push(b),i.push(_)});let a=[],s=[];Object.entries(n).forEach(h=>{let g=h[0],b=h[1],_=this.outputNames.indexOf(g);if(_===-1)throw new Error(`invalid output '${g}'`);a.push(b),s.push(_)});let u=o.map((h,g)=>Wx(h,()=>`input "${this.inputNames[i[g]]}"`)),l=a.map((h,g)=>h?Wx(h,()=>`output "${this.outputNames[s[g]]}"`):null),d=await Ux(this.sessionId,i,u,s,l,t),p={};for(let h=0;h<d.length;h++)p[this.outputNames[s[h]]]=a[h]??PD(d[h]);return _t(),p}startProfiling(){}endProfiling(){Fx(this.sessionId)}}});var jx={};Ir(jx,{OnnxruntimeWebAssemblyBackend:()=>us,initializeFlags:()=>qx,wasmBackend:()=>ED});var qx,us,ED,Kx=L(()=>{"use strict";ht();Zc();Hx();qx=()=>{(typeof he.wasm.initTimeout!="number"||he.wasm.initTimeout<0)&&(he.wasm.initTimeout=0);let r=he.wasm.simd;if(typeof r!="boolean"&&r!==void 0&&r!=="fixed"&&r!=="relaxed"&&(console.warn(`Property "env.wasm.simd" is set to unknown value "${r}". Reset it to \`false\` and ignore SIMD feature checking.`),he.wasm.simd=!1),typeof he.wasm.proxy!="boolean"&&(he.wasm.proxy=!1),typeof he.wasm.trace!="boolean"&&(he.wasm.trace=!1),typeof he.wasm.numThreads!="number"||!Number.isInteger(he.wasm.numThreads)||he.wasm.numThreads<=0)if(typeof self<"u"&&!self.crossOriginIsolated)he.wasm.numThreads=1;else{let e=typeof navigator>"u"?jr("node:os").cpus().length:navigator.hardwareConcurrency;he.wasm.numThreads=Math.min(4,Math.ceil((e||1)/2))}},us=class{async init(e){qx(),await zx(),await Mx(e)}async createInferenceSessionHandler(e,n){let t=new ss;return await t.loadModel(e,n),t}},ED=new us});ht();ht();ht();var _f="1.27.0";var dK=zs;{let r=(Yy(),Kr(Jy)).onnxjsBackend;ar("webgl",r,-10)}{let r=(Kx(),Kr(jx)).wasmBackend;ar("webgpu",r,5),ar("webnn",r,5),ar("cpu",r,10),ar("wasm",r,10)}Object.defineProperty(he.versions,"web",{value:_f,enumerable:!0});export{d2 as InferenceSession,fi as TRACE,sr as TRACE_EVENT_BEGIN,ur as TRACE_EVENT_END,At as TRACE_FUNC_BEGIN,_t as TRACE_FUNC_END,$t as Tensor,dK as default,he as env,ar as registerBackend};
/**
 * @license
 * Copyright 2021 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */
/**
 * @license
 * Copyright 2020 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */
/**
 * @license
 * Copyright 2019 Google LLC. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 * =============================================================================
 */
/*! Bundled license information:

long/index.js:
long/umd/index.js:
  (**
   * @license
   * Copyright 2009 The Closure Library Authors
   * Copyright 2020 Daniel Wirtz / The long.js Authors.
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *     http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *
   * SPDX-License-Identifier: Apache-2.0
   *)
*/
//# sourceMappingURL=ort.all.bundle.min.mjs.map
