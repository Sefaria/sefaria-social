# Demo content (spec 028)

A fresh deployment, preview or QA run can be filled with a believable community: four invented institutions (a shul, a
yeshiva, a Daf Yomi circle, a women's beit midrash), five invented people, fourteen posts anchored to well-known sources in
Tanakh, Talmud, Mishnah and liturgy, replies, Yasher koach, follows and notifications. Nothing in it is personal data.

```bash
DATABASE_URL=postgres://…/<a database whose name contains "test"> npm run qa:seed -- demo
DATABASE_URL=… npm run qa:seed -- demo --for <Sefaria user id>   # that account follows the institutions and runs the first
```

Seeding twice adds nothing (stable ids). The seed refuses a database whose name does not contain "test" (spec 082), so it never
touches production. Personas in the scenario use user ids 910001–910005; e2e and QA tokens for them see a full timeline.
