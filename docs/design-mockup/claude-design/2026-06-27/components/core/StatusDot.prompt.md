`StatusDot` shows a tool call's lifecycle as a single colored dot.

```jsx
<StatusDot status="in_progress" />  // orange, pulsing
<StatusDot status="completed" />    // green
<StatusDot status="failed" />       // red
```

`status`: pending (grey) / in_progress (orange, pulses) / completed (green) / failed (red). Colors are fixed across themes for unambiguous reading.
