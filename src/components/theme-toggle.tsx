import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";

/**
 * Flips the `.dark` class on <html> and remembers the choice. Stays `null` until
 * mounted so the server render and first client render agree (no hydration
 * mismatch) — the inline no-flash script in __root has already applied the real
 * theme by then, so there's no visible flicker.
 */
export function ThemeToggle() {
	const [theme, setTheme] = useState<"light" | "dark" | null>(null);

	useEffect(() => {
		setTheme(
			document.documentElement.classList.contains("dark") ? "dark" : "light",
		);
	}, []);

	const toggle = () => {
		const next = theme === "dark" ? "light" : "dark";
		document.documentElement.classList.toggle("dark", next === "dark");
		try {
			localStorage.setItem("scoop-theme", next);
		} catch {
			// Storage may be blocked; the toggle still works for this session.
		}
		setTheme(next);
	};

	return (
		<Button
			variant="ghost"
			size="icon-sm"
			onClick={toggle}
			aria-label={
				theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
			}
			className="rounded-full text-cocoa-soft"
		>
			{theme === "dark" ? (
				<Sun className="size-4" aria-hidden />
			) : theme === "light" ? (
				<Moon className="size-4" aria-hidden />
			) : null}
		</Button>
	);
}
