# The files search's modes are pressed buttons over one field (issue #827)

The files panel's search (#117) had Names and Content as tabs, each with a panel holding its own
search field. The two panels were the same field, and a pick unmounted one and mounted the other,
so the focus fell out of the field. Tabs also announce a panel per tab, which there was not.

Now Names and Content are two pressed outline buttons in a fieldset named "Search by" (the hub's
view toggle does the same), over one field. A pick changes what the field searches, keeps its
text and puts the focus back in it. A pressed button shows the accent fill and a ring (#816).

## Masking in the app

A match's line and path go through the app's `SecretScanner`, with the hosts' tokens and the
vault's values. A path that changes under it shows masked and Hidden and opens nothing, since the
viewer would name the real path. The masking runs on every render, not once per answer, so a vault
value learned after the answer still hides.

The scanner only knows token shapes and vault values of 6 characters or more (`MIN_VAULT_VALUE`),
so a shorter secret in a path is not caught here. The host is the first cover: it masks a line
before it cuts it, and leaves out a path shaped like a secret (#829).
