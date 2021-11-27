const parser = require('./dist/cjs/production');

parser.default(`
---
let count = $signal(0);

function increment() {
  count++;
}
function decrement() {
  count--;
}
---
<div class="flex items-center justify-center space-x-2 text-white p-2 rounded-lg bg-gray-900 bg-opacity-10">
  <button onClick={increment} class="p-2 rounded-lg bg-gray-900 bg-opacity-10">
    Increment
  </button>
  <span>Count: {count}</span>
  <button onClick={decrement} class="p-2 rounded-lg bg-gray-900 bg-opacity-10">
    Decrement
  </button>
</div>
`, {
  target: 'dom',
  dev: true,
  hmr: 'esm',
}).then(console.log, console.error);