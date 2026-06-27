import React from "react";

export interface CardProps {
  children?: React.ReactNode;
  /** Add hover lift + pointer (dashboard rows). */
  interactive?: boolean;
  /** CSS padding. Default "1rem". */
  padding?: string;
  /** Element/tag to render. Default "div". */
  as?: keyof JSX.IntrinsicElements;
  onClick?: (e: React.MouseEvent) => void;
  style?: React.CSSProperties;
}

/**
 * @startingPoint section="Core" subtitle="Elevated surface, optional hover" viewport="700x180"
 *
 * Elevated surface for dashboard rows, settings groups, panels.
 */
export function Card(props: CardProps): JSX.Element;
