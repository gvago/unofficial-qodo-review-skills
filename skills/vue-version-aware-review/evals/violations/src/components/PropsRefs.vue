<script setup>
import { computed, toRefs } from 'vue'
const props = defineProps({ price: { type: Number, required: true } })
const { price } = toRefs(props)
const total = computed(() => price.value * 2)
</script>
<template><output>{{ total }}</output></template>
