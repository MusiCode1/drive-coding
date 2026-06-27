`Toggle` is DriveCoding's on/off switch — accent fill when on, RTL-aware knob.

```jsx
const [on, setOn] = React.useState(false);
<Toggle checked={on} onChange={setOn} ariaLabel="קול" />
```

Controlled: pass `checked` + `onChange(next)`. Used for settings, speaker mute, car mode.
