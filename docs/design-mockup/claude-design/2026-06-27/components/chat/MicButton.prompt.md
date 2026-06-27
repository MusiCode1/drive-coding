`MicButton` is DriveCoding's centerpiece — the single 110px control that drives the entire voice loop. Color, icon, and animation encode the state machine.

```jsx
const [state, setState] = React.useState("idle");
<MicButton state={state} onClick={cycle} onStop={() => setState("idle")} />
```

`state`: idle (accent) → recording (red, halo pulse) → transcribing/thinking (thinking color, spinner) → speaking (green + floating stop) → cancelling (flash). Disabled during transcribing/cancelling. Hebrew status text shows below by default (`showStatus={false}` to hide).
