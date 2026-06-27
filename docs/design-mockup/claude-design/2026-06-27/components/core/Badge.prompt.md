`Badge` is a small status/label pill, used for agent connection state and generic tags.

```jsx
<Badge tone="connected" dot>מחובר</Badge>
<Badge tone="connecting" dot>מתחבר…</Badge>
<Badge tone="accent">claude</Badge>
```

Tones: `neutral | accent | connected | connecting | error`. Pass `dot` to prepend a colored status dot.
