import { useEffect, useRef, useState } from "react";

// Animuje liczbe od aktualnie wyswietlanej wartosci do nowego celu (rAF,
// ease-out) zamiast przeskakiwac od razu - zeby zmiana wartosci w oknie boi
// przy przejsciu miedzy klatkami czasu wygladala jak plynne "dobiegniecie",
// a nie skok. `deltaFn` pozwala nadpisac sposob liczenia roznicy (np. dla
// katow, gdzie krotsza droga bywa "przez zero").
export function useAnimatedNumber(target, { duration = 450, deltaFn } = {}) {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const startRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    fromRef.current = value;
    startRef.current = null;
    cancelAnimationFrame(rafRef.current);

    const delta = deltaFn ? deltaFn(fromRef.current, target) : target - fromRef.current;
    const from = fromRef.current;

    function tick(ts) {
      if (startRef.current === null) startRef.current = ts;
      const t = Math.min(1, (ts - startRef.current) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(from + delta * eased);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, duration]);

  return value;
}

// Najkrotsza droga katowa (np. 350deg -> 10deg animuje sie przez 0/360, o 20
// stopni, a nie do tylu przez caly okrag).
export function shortestAngleDelta(from, to) {
  let delta = ((to - from + 180) % 360) - 180;
  if (delta < -180) delta += 360;
  return delta;
}
