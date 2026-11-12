<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
const props=defineProps({id:{type:[Number,String],required:true},token:{type:String,required:true}})
const root=ref(null), url=ref(''), failed=ref(false), opened=ref(false)
let observer, disposed=false
async function load(){try{const r=await fetch('/api/withdrawals/'+props.id+'/proof',{headers:{Authorization:`Bearer ${props.token}`},cache:'no-store'});if(!r.ok)throw new Error('load failed');const blob=await r.blob();if(!disposed)url.value=URL.createObjectURL(blob)}catch{if(!disposed)failed.value=true}}
function onBack(event){if(opened.value){opened.value=false;event.preventDefault()}}
function onKey(event){if(event.key==='Escape' && opened.value)opened.value=false}
onMounted(()=>{window.addEventListener('cym-native-back',onBack);window.addEventListener('keydown',onKey);if('IntersectionObserver' in window){observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load()}},{rootMargin:'100px'});observer.observe(root.value)}else load()})
onUnmounted(()=>{disposed=true;observer?.disconnect();window.removeEventListener('cym-native-back',onBack);window.removeEventListener('keydown',onKey);if(url.value)URL.revokeObjectURL(url.value)})
</script>
<template><div ref="root"><button v-if="url" class="proof-button" aria-label="查看转账截图原图" @click="opened=true"><img class="proof-thumb" :src="url" alt="转账截图缩略图"></button><span v-else>{{ failed ? '截图加载失败，请刷新重试' : '截图加载中…' }}</span><div v-if="opened" class="proof-viewer" role="dialog" aria-label="转账截图原图" @click.self="opened=false"><button class="proof-close" aria-label="关闭图片" @click="opened=false">×</button><img :src="url" alt="转账截图原图"></div></div></template>
<style scoped>.proof-button{border:0;background:none;padding:0;display:block}.proof-thumb{display:block;width:96px;height:96px;object-fit:cover;border-radius:8px;border:1px solid #eee;margin-top:8px}.proof-viewer{position:fixed;inset:0;z-index:1000;background:#000e;display:flex;align-items:center;justify-content:center;overflow:auto}.proof-viewer img{max-width:100%;max-height:100%;object-fit:contain}.proof-close{position:fixed;top:16px;right:16px;z-index:1001;border:0;border-radius:50%;background:#0009;color:white;font-size:28px;width:44px;height:44px}</style>
