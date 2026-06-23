import { useCallback, useEffect, useState } from "react";
import { fetchThemeCounts, type ThemeCount } from "../../../lib/pending-client";

export function useThemes() {
	const [themes, setThemes] = useState<ThemeCount[]>([]);
	const [themesLoading, setThemesLoading] = useState(true);
	const [selectedTheme, setSelectedTheme] = useState<string | null>(null);

	const refreshThemes = useCallback(async () => {
		setThemesLoading(true);
		setThemes(await fetchThemeCounts());
		setThemesLoading(false);
	}, []);

	useEffect(() => {
		void refreshThemes();
	}, [refreshThemes]);

	return {
		themes,
		themesLoading,
		selectedTheme,
		setSelectedTheme,
		refreshThemes,
	};
}
