# HSK 1 Notes: Product Requirements Document

Status: Version 1 is built. It is not yet deployed with the latest fixes.
Date: 2026-11-19

## 1. Summary

HSK 1 Notes is a small web app. A user writes a personal description for each HSK 1 word. The user also reads the descriptions of other users. The app helps learners remember words in their own way and learn from each other.

## 2. Problem

A learner of Chinese has a word list but no place to store memory aids. A learner also cannot see how other learners remember the same word. A shared place for short notes solves both problems.

## 3. Goals

- Let a user create an account and log in.
- Show the HSK 1 word list with pinyin and meaning.
- Let each user write one description for each word.
- Let each user read the descriptions of all other users.
- Let each user update or delete only their own description.

## 4. Non-goals

- Levels other than HSK 1.
- Password reset by email.
- Likes, comments, or replies on a description.
- Audio, stroke order, or quizzes.
- Moderation tools.
- A mobile app.

## 5. Users

The main user is a beginner learner of Chinese. The user has a laptop and a web browser. The user knows how to use a simple web page.

## 6. User stories

1. As a new user, I create an account with a username and a password.
2. As a user, I log in and log out.
3. As a user, I see all HSK 1 words in a grid.
4. As a user, I search for a word by character, pinyin, or meaning.
5. As a user, I click a word and see its pinyin, its meaning, and all descriptions.
6. As a user, I write a description for a word.
7. As a user, I update my description of a word.
8. As a user, I delete my description of a word.
9. As a user, I see which words have my description. I also see how many descriptions each word has.

## 7. Functional requirements

### 7.1 Accounts

| ID | Requirement |
|----|-------------|
| A1 | The username has 3 to 20 characters. It uses letters, digits, or underscore. |
| A2 | The username is unique. The check ignores the case of letters. |
| A3 | The password has 8 to 200 characters. |
| A4 | The server stores only a salted scrypt hash of the password. |
| A5 | After registration, the user is logged in at once. |
| A6 | A session lasts 7 days. The server stores only a hash of the session token. |
| A7 | Log out ends the session on the server. |

### 7.2 Word list

| ID | Requirement |
|----|-------------|
| W1 | The database contains the HSK 1 words (HSK 2.0 standard). The list has 149 words. |
| W2 | Each word has a hanzi, a pinyin, and an English meaning. |
| W3 | The word list loads when the server starts. A repeated start does not make duplicates. |
| W4 | The search filters the grid as the user types. |

### 7.3 Descriptions

| ID | Requirement |
|----|-------------|
| D1 | A user has at most one description for each word. |
| D2 | A description has 1 to 1000 characters. |
| D3 | All logged-in users can read all descriptions. |
| D4 | A user can change or delete only their own description. |
| D5 | The page shows descriptions as plain text. It does not run HTML or scripts. |
| D6 | The list shows the newest update first. |

## 8. Pages

- **Login page (`index.html`):** username field, password field, a Log in button, and a Create account button.
- **Main page (`app.html`):** header with the username and a Log out button, a search field, the word grid, and a detail panel.
- **Detail panel:** shows the word, the descriptions of all users, and a field for the description of the current user.

## 9. API

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/register` | Create an account and start a session. |
| POST | `/api/login` | Start a session. |
| POST | `/api/logout` | End the session. |
| GET | `/api/me` | Get the current username. |
| GET | `/api/characters` | List all words with the number of descriptions. |
| GET | `/api/characters/{id}/descriptions` | List the descriptions of one word. |
| PUT | `/api/characters/{id}/description` | Create or update my description. |
| DELETE | `/api/characters/{id}/description` | Delete my description. |

All calls except register and login need a valid session.

## 10. Data model

- `users`: id, username, salt, hash, created.
- `sessions`: token hash, user id, expiry.
- `characters`: id, hanzi, pinyin, meaning.
- `descriptions`: id, user id, character id, text, updated. The pair (user id, character id) is unique.

## 11. Non-functional requirements

- **Security:** The session cookie is `HttpOnly` and `SameSite=Lax`. The API accepts only JSON requests. nginx limits login and registration to 30 requests a minute for each IP address.
- **Reliability:** The server sends a success reply only after the database commit.
- **Simplicity:** The server uses only the Python standard library. The database is one SQLite file.
- **Size:** The server rejects a request body of more than 8 KB.
- **Browsers:** The app works in a current version of Chrome, Firefox, Safari, and Edge.

## 12. Deployment

The app runs on a DigitalOcean droplet. The `systemd` service `crud-app` runs `server.py` on port 8000. nginx listens on port 80 and sends all requests to the app. The command `sudo ./deploy.sh` installs the service and the nginx configuration.

## 13. Success metrics

- A new user creates an account and saves a first description in less than 2 minutes.
- No user can change the description of another user.
- 95% of page requests finish in less than 300 ms on the droplet.

## 14. Risks and open questions

- **No HTTPS.** The site uses HTTP. Passwords and session cookies travel as plain text. Fix: get a domain name, add a Let's Encrypt certificate, and set the `Secure` flag on the cookie.
- **No password reset.** A user who forgets the password loses the account. Question: do we add email reset?
- **No moderation.** Any user can write any text. Question: do we need a report button or an admin role?
- **Word list.** The list has 149 words, not 150. One word is missing. Question: do we use the new HSK 3.0 list instead?
- **Backups.** The database is one file with no backup. Question: do we need a daily copy?

## 15. Future ideas

- HSK 2 to HSK 6 word lists.
- Voting for the best description of a word.
- Quiz mode that uses the descriptions of the user.
- A user profile page.
