import * as React from "react";
type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "outline" | "destructive" | "ghost";
  size?: "sm" | "md";
};
export function Button({ variant="default", size="md", className="", ...props }: Props) {
  const base = "inline-flex items-center justify-center rounded-md border text-sm";
  const sizes = size === "sm" ? "px-2 py-1" : "px-3 py-2";
  const variants: Record<string,string> = {
    default: "bg-black text-white border-black",
    secondary: "bg-white text-black border-gray-300",
    outline: "bg-white text-black border-gray-300",
    destructive: "bg-white text-red-600 border-red-400",
    ghost: "bg-transparent border-transparent",
  };
  return <button className={`${base} ${sizes} ${variants[variant]} ${className}`} {...props} />;
}
