<script setup>
import { onMounted, ref } from 'vue'
const ticks = ref(0)
function tick() { ticks.value++ }
onMounted(() => {
  window.addEventListener('resize', tick)
  setInterval(tick, 1000)
})
</script>
<template><output>{{ ticks }}</output></template>
