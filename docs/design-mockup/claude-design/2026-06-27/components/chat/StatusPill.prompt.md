`StatusPill` is the live "what the agent is doing" indicator — a pulsing dot and label shown above the chat.

```jsx
<StatusPill phase="calling-tool" />
<StatusPill phase="responding" />
```

`phase`: waiting / thinking / responding / calling-tool / pending-tts / speaking. Override the text with `label`.
