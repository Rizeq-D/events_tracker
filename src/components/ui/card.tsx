import * as React from "react";
export function Card(p: React.HTMLAttributes<HTMLDivElement>) { return <div {...p} className={`border rounded-2xl p-0 bg-white ${p.className||""}`} />; }
export function CardHeader(p: React.HTMLAttributes<HTMLDivElement>) { return <div {...p} className={`p-4 border-b ${p.className||""}`} />; }
export function CardTitle(p: React.HTMLAttributes<HTMLHeadingElement>) { return <h3 {...p} className={`font-semibold ${p.className||""}`} />; }
export function CardContent(p: React.HTMLAttributes<HTMLDivElement>) { return <div {...p} className={`p-4 ${p.className||""}`} />; }
