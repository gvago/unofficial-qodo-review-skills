<script setup>
const props = defineProps({ total: { type: Number, required: true } })
function reset() { props.total = 0 }
</script>
<template><button @click="reset">Reset {{ props.total }}</button></template>
