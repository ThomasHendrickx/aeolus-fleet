# Organisms

Shared larger sections, used by two or more features; props only, so the page or the feature organism that uses them supplies the data. ConsoleFrame (Sidebar on desktop, TabBar on phone) is what the signed-in route layout fills; each page shows a ListPage or a DetailPage inside it, with Header and TopBar. AccountMenu (and AccountMenuSheet on phone) and the dialogs several features open: StartingPromptDialog, CrewLineDialog, CrewReleaseDialog and RemoveMemberDialog. An organism only one feature uses, or one that takes its data through hooks, lives in that feature.
