<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
const props=defineProps({id:{type:[Number,String],required:true},token:{type:String,required:true}})
const root=ref(null), url=ref(''), failed=ref(false)
let observer, disposed=false
async function load(){try{const r=await fetch('/api/withdrawals/'+props.id+'/proof',{headers:{Authorization:`Bearer ${props.token}`},cache:'no-store'});if(!r.ok)throw new Error('load failed');const blob=await r.blob();if(!disposed)url.value=URL.createObjectURL(blob)}catch{if(!disposed)failed.value=true}}
onMounted(()=>{if('IntersectionObserver' in window){observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){observer.disconnect();load()}},{rootMargin:'100px'});observer.observe(root.value)}else load()})
onUnmounted(()=>{disposed=true;observer?.disconnect();if(url.value)URL.revokeObjectURL(url.value)})
</script>
<template><div ref="root"><a v-if="url" :href="url" target="_blank" rel="noopener" aria-label="查看转账截图原图"><img class="proof-thumb" :src="url" alt="转账截图缩略图"></a><span v-else>{{ failed ? '截图加载失败，请刷新重试' : '截图加载中…' }}</span></div></template>
<style scoped>.proof-thumb{display:block;width:96px;height:96px;object-fit:cover;border-radius:8px;border:1px solid #eee;margin-top:8px}</style>
