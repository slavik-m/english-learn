import { render } from "solid-js/web";
import { onMount } from "solid-js";
import { registerSW } from "virtual:pwa-register";
import { App } from "./App";
import "./styles.css";

const Root = () => {
  onMount(() => {
    registerSW({ immediate: true });
  });

  return <App />;
};

render(() => <Root />, document.getElementById("app")!);
