<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, toRefs } from 'vue'
const props = defineProps({ price: { type: Number, required: true } })
const { price } = toRefs(props)
const total = computed(() => price.value * 2)
const model = defineModel({ type: String, required: true })
const field = ref(null)
const rows = reactive([{ id: 'a', name: 'North' }, { id: 'b', name: 'South' }])
function tick() { document.title = String(total.value) }
let timer
onMounted(() => { window.addEventListener('resize', tick); timer = setInterval(tick, 1000) })
onUnmounted(() => { window.removeEventListener('resize', tick); clearInterval(timer) })
function reverse() { rows.reverse() }
</script>
<template>
  <section><label>Guest<input ref="field" v-model="model"></label><button @click="reverse">Reverse</button>
    <input v-for="row in rows" :key="row.id" :value="row.name" :aria-label="row.name">
    <output>{{ total }}</output>
  </section>
</template>
