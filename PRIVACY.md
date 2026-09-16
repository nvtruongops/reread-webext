# Privacy policy for re/read

Last updated: 12 September 2026. This document is kept in the extension's repository, so
every change to it is a commit anyone can read: [`PRIVACY.md`](https://github.com/fundacja-reborn/reread-webext/blob/main/PRIVACY.md).

## The short version

re/read collects nothing. There is no account, no server, no telemetry, no analytics,
no advertising and no profiling. Nothing you read, select, save or search for leaves
your device.

The extension does not use any online service. There is no server it connects to, and the
publisher receives no data from it of any kind - not even a count of installations
beyond what the add-on stores themselves report to us.

## What re/read stores, and where

Everything the extension keeps is stored in your browser's local extension storage on
your device: four IndexedDB databases (`reread-vocab`, `reread-articles`, `reread-dicts`,
`reread-models`) and the extension's `storage.local`, which holds the settings and the
safety copies of the vocabulary, the highlights and the reading list. None of it is synced
to any account, and none of it can be read by the pages you visit (what a page can see of
the extension's work on it is described under *Page content*); you can look at all of it in
the browser's developer tools, under the extension's own origin.

In a private window, Firefox gives the extension's pages a separate database that is
deleted when the private session ends. The pages fill it from the safety copies, which a
private session reads and never writes: an article saved, a book imported, a highlight made
or anything deleted in a private window is gone with the session, and nothing about that
session remains in the copies. Saved phrases are the one exception - they are handled by
the extension's background, which is never private, and are kept; so are the two counts
kept with a phrase (below), which a private window adds to like any other.

| What | Why it is stored |
|---|---|
| Saved phrases with their meanings, two counts per phrase (how many times you opened its bubble, how many times it occurred in the texts you finished) and, only when you turn on **Save the sentence with the phrase**, the sentence each phrase was saved in (or, for a phrase saved without one, the sentence its bubble was next opened in) - see *Page content* | To underline them on later pages and show your meaning again; the counts, to help you decide what you have learned; the sentence, for a flashcard that shows the phrase in use |
| Translation models you downloaded | So translation works offline |
| Dictionaries you installed | So dictionary lookups work offline |
| Articles and books you saved to the reading list | So they open with no network, and after the original page has changed or gone |
| Highlights, notes and reading positions | To open a document again the way you left it |
| Settings, including the list of sites you switched re/read off on | To keep your choices between sessions |

Uninstalling the extension deletes all of it, because the browser deletes an
extension's storage together with the extension. You can also remove any part of it
from inside the extension itself: individual phrases (**Learned**), individual
articles and books (**Delete**), models and dictionaries (their sections in
Settings), and the per-site off switches (Settings, **Switched-off sites**). Deleting an
article or a book removes everything stored for it - text, pictures, highlights, notes and
the reading position - from the database and from the safety copy in `storage.local`.
Saved phrases are not part of an article: a phrase you saved while reading it is stored in
your vocabulary, without any record of where it came from, and is kept there until you mark
it **Learned** - deleting the article does not delete the phrase. The same holds for the
sentence saved with a phrase (see *Page content*): it is stored with the phrase, not with the
article, so deleting the article does not delete it either.

You can export your data at any time to files on your disk: everything at once, as one
`.zip` backup from the reading list - the reading list with its highlights, reading positions
and, if you tick the box, pictures; the books with their text, pictures and reading positions,
if you tick their box; every saved phrase with its sentence and counts; the settings, including the sites you switched re/read off on and your custom CSS - or the parts
on their own: vocabulary as TSV (two columns, or three with the saved sentences, for Anki), a
selection of the reading list - articles and books - as a `.zip` of the same kind, highlights
as Markdown. The browser saves those files the way it saves any download; they are not uploaded
anywhere. Importing a backup writes only what is missing here and changes nothing already
saved; the settings in it replace yours only when you tick the box.

## What leaves your device

Requests go to exactly two servers, both with addresses built into the extension, and
only after you click a button on the Settings page:

- **`storage.googleapis.com`** - the storage where Mozilla publishes its translation
  models: the list of models and the model files themselves.
- **`download.wikdict.com`** - the [WikDict](https://www.wikdict.com/) catalogue: the
  list of available dictionaries and the dictionary files themselves.

These are ordinary file downloads. Like any download, they let the server that sends the
file see your IP address and your browser's user agent; re/read adds no identifier,
no cookie and no query of its own, and sends nothing about you, your vocabulary or
the pages you read. Opening the Settings page makes no request at all - the lists
shown there come from a copy included in the extension until you press **Update the list**,
and each list shows the date it was last fetched.

Two more requests happen only when you ask for them, and they are the only ones to
addresses that are not built into the extension.

The first is **Add a dictionary from a link** on the Settings page: it downloads a
dictionary archive from the address you paste there - once, without cookies or referrer,
when you press **Download** - and the server at that address sees what any download shows
it: your IP address and your browser's user agent. The address is yours: the extension
suggests none, and a link is followed wherever its host sends it, the way the browser's
own download would be; when it led to another server, the Settings page says which. The
archive is unpacked and checked on your device exactly like files you pick by hand, and
only `https` addresses are accepted.

The second is **Download pictures**, a row in the reader's menu
over a saved article, downloads that article's pictures from the addresses the pictures
point at - the site the article came from, its image server, or another site the page
embedded a picture from - once, without cookies or referrer, and only when you press it.
Each of those servers sees what it saw when the page first showed you the pictures: your
IP address and your browser's user agent, nothing more. The extension never downloads a
picture on its own; a saved article contains only text until you press that row. Once
the pictures are downloaded, the same menu row changes to **Remove pictures**, which
deletes them again. The pictures of a book come from the `.epub` file you import and
are stored with the book at that moment; no request is made for them, ever.

There is no third server of the extension's own. No fonts, scripts or images are loaded
from outside the extension, there is no crash reporting, no A/B testing and no update
check of the extension's own (updates are handled by the browser and the add-on store you
installed from, under their policies). A download from one of the two built-in addresses
that a server redirects to another host is refused rather than followed, so those two are
the only addresses the extension's own downloads can come from; only a link you pasted
yourself is followed where it leads, and the Settings page names the host it ended at.
The custom CSS you can type on the settings page is
checked before it is stored, and a rule that would load anything (url(), @import, @font-face)
is refused - so it cannot become a third address either.

You do not have to take our word for it: watch the network panel in the browser's
developer tools, read the source code (the extension is published unminified, exactly as it
is in the repository), or simply turn the network off - translation, dictionaries, the
reading list and everything else keep working.

## Reading aloud

Reading aloud uses the browser's own speech synthesis (the standard Web Speech API). The
extension passes the text to the browser and nothing else; it makes no network request
for speech.

Some browsers add online voices to that engine - Chrome's "Google ..." voices, Edge's
"... Online" voices - which send the text to the browser maker's server to be spoken.
The browser marks them as online voices, and re/read does not use them: they never appear
in a voice list and never speak. When the device has no offline voice for a language,
re/read does not read that language aloud and shows a message, instead of letting the
browser pick an online voice.

One thing remains outside the extension's control: a voice that the operating system
provides and the browser reports as offline can still be generated by the system over the
network, if the system is set up that way. That is a matter of your operating system and its
privacy policy, not of re/read, and it applies to every application that speaks on that
system. Firefox for Android is the one browser that lists no voices at all; there re/read
hands the text to the browser with the language alone, and the system's speech engine
picks the voice, under the system's own settings.

## Language detection

Before a selected phrase is translated, re/read checks which language it is in, so that a page
in your own language is not fed to a translation model built for another one. This uses the
browser's built-in language detector (the `i18n.detectLanguage` extension API), which is Compact
Language Detector (CLD): in Firefox CLD2, compiled into the browser and run in a worker that
ships with it; in Chromium-based browsers CLD3, linked into the browser itself. Both run on your
device, load no model from the network and send nothing anywhere: the text never leaves the
browser. We have checked this in both browsers' source code, not only in their documentation
(Firefox: `toolkit/components/translations/LanguageDetector.sys.mjs` and the `cld-worker.js` it
starts; Chromium: `extensions/renderer/api/i18n_hooks_delegate.cc`, built on `third_party/cld_3`).
Safari provides no such detector; there re/read skips the check and behaves as before. This is
unrelated to the browsers' own page-translation features (Chrome's "Translate this page", Firefox
Translations), which re/read does not use.

What the detector is handed: at most one sentence - the sentence around the selection, or the
selection itself when there is no sentence around it - cut to 400 characters, and only when you
select text with a translation model switched on. Never the page, its address or its title.

What we can and cannot promise: re/read does not control the browser's code. Today's
implementations are local and the API is documented as CLD-based; we check both browsers' source
code again with every release of re/read and update this section if anything changes. Should a
browser ever back this call with a network service, re/read would stop using it before the next
release. Where the detector is missing, re/read simply skips the check.

## Page content

The part of the extension that runs on web pages reads the text of the pages you visit,
in order to find your saved phrases in it and underline them. This happens entirely in your browser's memory, on
your device. The text is not stored, not sent and not indexed; nothing is written
anywhere except what you yourself keep: a phrase you save - a phrase of up to four words
is saved as soon as you select it and its translation arrives, longer ones wait for
**Save** - and the article you open in the reader, which is kept in the reading list by
default (a setting turns that off). Only your own selecting and clicking count: a page's
own scripts cannot select a phrase or press a button on the extension's behalf.

Two counts are kept with each saved phrase, on your device like the phrase itself: how
many times you opened its bubble (clicked its underline, or selected it again), and how many
times it occurred in the texts you finished in the reader - a part of a book you left
through the **Next** button under its text, or an article you marked as read - each with
the time it last happened. They are shown on the saved phrases page, which can order the
list by them. They record no page, no title and no text: not where you met the phrase, only
how often. A page you read outside the reader adds to the first count only, when you open a
bubble on it, and to nothing else - apart from the sentence described next, once you have
turned that on. Marking a phrase **Learned** deletes its counts with it.

One more thing can be kept with a saved phrase, and only after you turn on **Save the
sentence with the phrase** in Settings - it is off until you do: the sentence around the
phrase when you saved it from the bubble. It is the sentence as the page shows it, at most one
sentence and at most 600 characters, without its translation; it records no page, no title
and no address. It is shown under the phrase on the saved phrases page and written into the
third column of the file that **Export for Anki** makes; nothing else reads it, and it never
leaves your device. Only the first sentence is kept - saving the same phrase again changes its
meanings, not the sentence. A phrase you save from the **Add a phrase** field has no sentence.
A phrase imported from a file has the sentence from the file's third column, if any, whatever
the setting says - the file is your own; for a phrase already saved, the file's sentence is
added only when the phrase has none. For a phrase that has no sentence - saved before you
turned the setting on, from the **Add a phrase** field, or from a file without one - the
sentence around it is saved the next time you open its bubble on a page: one sentence, under
the same limits, and only while the setting is on. Marking a phrase **Learned** deletes its
sentence with it; switching the setting off saves no new sentences, and the ones already
saved are kept.

A page you have switched re/read off on (the toolbar popup, or the list in Settings)
is not read at all: no scan, no underlines, no bubble. The one thing that still works
there is opening the page in the reader yourself, with the keyboard shortcut or the
toolbar popup - that reads the page, like on any other site, because you asked.

What a page can see of this: on a page where your saved phrases are underlined, the
page's own scripts can tell that re/read is installed and which of the page's words are
underlined. The underlines are drawn with the browser's highlight registry, which the page
shares - that is what makes them possible without changing the page's HTML, and it is also
what lets the page look at them. A page learns nothing else: not the rest of your
vocabulary, not the bubble, not what you save. The **Only in the reader** setting keeps
ordinary pages free of underlines and of the bubble, so with it on no page can tell that
re/read is there. Two smaller things a page can notice, on any setting: the bubble's
container appears in the page for as long as the bubble is shown (its contents are
sealed off), and reading a phrase aloud uses the page's speech queue, which the page can
see is busy.

## Permissions

| Permission | Why it is needed |
|---|---|
| `storage` | Your vocabulary and settings, in the browser's local extension storage. Never synced. |
| `unlimitedStorage` | Translation models are tens of megabytes and dictionaries can be larger; the browser's default quota is not enough for them. |
| `<all_urls>` (access to all websites) | Saved phrases are underlined on every page where they appear, so the content script has to be able to run everywhere. This is a broad permission: it means the extension can read the pages you visit. It reads them locally to find your saved phrases, and sends nothing. There is no narrower permission for "every page you might read". |
| `contextMenus` (the right-click menu) | The **re/read** entries in the right-click menu on any web page - **Read this page in the reader** and **Offline reading list** - for whoever never pinned the toolbar button. It adds two rows to the browser's menu and reads nothing from the page; the browser shows no consent prompt for it. |
| `offscreen` (Chrome/Chromium package only) | Chromium runs the extension's background part as a service worker, which cannot start the worker thread the translation engine runs in. A single hidden document (offscreen document) runs that worker instead. It grants no access to any page or to any data. |

There is deliberately nothing else: no `tabs`, no `webRequest`, no `cookies`, no
`downloads`, no `history`, no `bookmarks`.

## Data sharing

re/read does not collect user data, so there is nothing to share. No data is sold,
rented, transferred to third parties, used for advertising, used to build profiles,
or used for creditworthiness or lending purposes. No data is used for any purpose
unrelated to the extension's single purpose, which is translating and saving phrases
while you read and keeping a local reading list.

## Children

The extension collects no data from anyone, of any age.

## Changes to this policy

If it changes, the change is a commit in the public repository, with the date at the
top of this file updated. The version of the policy that applies to you is the one
published here.

## Who is behind re/read

re/read is made by **Fundacja Reborn**, a non-profit foundation registered in Poland
(KRS 0000708416, NIP PL7343554397), ul. Lwowska 35/5, 33-300 Nowy Sącz. In the
language of the GDPR the foundation would be the data controller - but in this case there
is no data to control, because the extension sends it nothing and it operates no service
the extension connects to.

The foundation's [general privacy policy](https://reapps.eu/privacy/) covers re/notes
and re/task, which do have accounts and a server. re/read has neither, and this
document is its policy.

## Contact

Questions, or something here that does not match what the code does:
[open an issue](https://github.com/fundacja-reborn/reread-webext/issues) or write to
dev@reapps.eu.

re/read is free software under
[AGPL-3.0-or-later](https://github.com/fundacja-reborn/reread-webext/blob/main/LICENSE).
