import { useEffect, useRef, useState } from "react";
import { mountScene, type SceneHandle } from "../engine/harness";
import type { PropValues, RecipeDef } from "../engine/types";

interface PreviewCanvasProps {
  recipe: RecipeDef;
  variant: string;
  props: PropValues;
}

/**
 * Live preview: owns one canvas + one SceneHandle. Variant/prop changes
 * flow through the handle; only a recipe change remounts the renderer.
 */
export function PreviewCanvas({ recipe, variant, props }: PreviewCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const latest = useRef({ variant, props });
  latest.current = { variant, props };

  const [fps, setFps] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      handleRef.current = mountScene(canvas, recipe, {
        variant: latest.current.variant,
        props: latest.current.props,
        onFps: setFps,
        onContextLost: () => setFailed(true),
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
    };
  }, [recipe]);

  useEffect(() => {
    handleRef.current?.setVariant(variant);
  }, [variant]);

  useEffect(() => {
    handleRef.current?.setProps(props);
  }, [props]);

  if (failed) {
    return (
      <div className="preview-frame">
        <div className="preview-fallback">
          WebGL is unavailable or the context was lost. Reload the page, or check
          that hardware acceleration is enabled in your browser.
        </div>
      </div>
    );
  }

  return (
    <div className="preview-frame">
      <div className="preview-canvas-box">
        <canvas ref={canvasRef} />
      </div>
      <span className="fps-meter">{fps === null ? "--" : fps} FPS</span>
    </div>
  );
}
