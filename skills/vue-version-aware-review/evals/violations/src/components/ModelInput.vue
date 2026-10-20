<script setup>
const model = defineModel({ type: String, required: true })
function clear() { model.value = '' }
</script>
<template><label>Guest<input v-model="model"></label><button @click="clear">Clear</button></template>
