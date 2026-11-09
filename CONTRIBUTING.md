# Contributing to Echoes

Thank you for your interest in contributing to Echoes! This guide will help you get started with development, understand our codebase, and follow our contribution workflow.

---

## Table of Contents

- [Development Setup](#development-setup)
- [Code Quality](#code-quality)
- [Project Structure](#project-structure)
- [Before You Contribute](#before-you-contribute)
- [Contributing Workflow](#contributing-workflow)
- [Commit Message Guidelines](#commit-message-guidelines)
- [Deployment](#deployment)

---

## Development Setup

### Prerequisites

- [Bun](https://bun.sh/) (preferred) OR [Node.js](https://nodejs.org/) (Version 22+ recommended)
- [Git](https://git-scm.com/)

### Quick Start

1. Fork the Repository on GitHub

2. Clone your fork:

    ```bash
    git clone https://github.com/YOUR_USERNAME/Echoes.git
    cd Echoes
    ```

3. Install dependencies:

    ```bash
    bun install
    # or
    npm install
    ```

4. Start the development server:

    ```bash
    bun run dev
    # or
    npm run dev
    ```

5. Open your browser:
   Navigate to `http://localhost:3000/`

---

## Code Quality

We maintain high code quality standards. All code must pass our linting checks before being merged.

### Our Tool Stack

| Tool                               | Purpose            | Files    |
| ---------------------------------- | ------------------ | -------- |
| [ESLint](https://eslint.org/)      | JavaScript linting | `*.js`   |
| [Stylelint](https://stylelint.io/) | CSS linting        | `*.css`  |
| [HTMLHint](https://htmlhint.com/)  | HTML validation    | `*.html` |
| [Prettier](https://prettier.io/)   | Code formatting    | All      |

### Available Commands

```bash
# Check everything (runs all linters)
bun run lint

# Auto-format all code
bun run format

# Fix JavaScript issues automatically
bun run lint:js -- --fix

# Fix CSS issues automatically
bun run lint:css -- --fix

# Check HTML
bun run lint:html

# Check specific file types
bun run lint:js
bun run lint:css
```

> ⚠️ **Important:** Ensure all lint and build checks pass (`npm run build`) before submitting a pull request.

---

### Key Directories

- **`/js`** - All JavaScript source code
    - Keep modules focused and single-purpose
    - Use ES6+ features
    - Keep the code easy to work with/maintain

- **`/public`** - Static assets copied directly to build
    - Images should be optimized before adding
    - Keep file sizes reasonable
    - Use appropriate formats (WebP/SVG/PNG)

---

## Before You Contribute

To ensure a smooth contribution process and avoid wasted effort, please adhere to the following guidelines before starting any major work.

### Consult on Major Features

If you're looking into contributing a big feature, please speak with us before starting work. You can reach out by opening a [GitHub Issue](https://github.com/ManuthMethnidu/Echoes/issues).

### Open Draft PRs Early

Whether you've spoken with us or not, we highly recommend opening **Draft Pull Requests** early. This allows us to catch potential architectural issues before you spend too much time on them.

### Responsible Development

- Make sure you understand **every line** of code you submit.
- Test your changes thoroughly across desktop and mobile screens.
- Do not submit unvetted automated slop that breaks existing player, queue, or playlist workflows.

---

## Contributing Workflow

### 1. Create a Branch

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/description-of-fix
```

### 2. Make Your Changes

- Follow existing code style
- Write clear, self-documenting code
- Add comments for complex logic
- Update documentation if needed

### 3. Test Your Changes

```bash
# Run all linters
bun run lint

# Test the build
npm run build
```

### 4. Commit Your Changes

Follow our [commit message guidelines](#commit-message-guidelines).

```bash
git add .
git commit -m "feat(player): add keyboard shortcut for loop toggle"
```

### 5. Push and Create a Pull Request

```bash
git push origin feature/your-feature-name
```

Then open a pull request on GitHub at `https://github.com/ManuthMethnidu/Echoes/pulls` with:

- Clear title describing the change
- Detailed description of what changed and why
- Reference any related issues

---

## Commit Message Guidelines

We use [Conventional Commits](https://www.conventionalcommits.org/) for clear, structured commit messages.

### Format

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

| Type       | Description                                       |
| ---------- | ------------------------------------------------- |
| `feat`     | New feature                                       |
| `fix`      | Bug fix                                           |
| `docs`     | Documentation changes                             |
| `style`    | Code style changes (formatting, semicolons, etc.) |
| `refactor` | Code refactoring without changing behavior        |
| `perf`     | Performance improvements                          |
| `test`     | Adding or updating tests                          |
| `chore`    | Maintenance tasks (dependencies, build, etc.)     |

### Scopes

Common scopes in our project:

- `player` - Audio player functionality
- `ui` - User interface components
- `api` - API integration
- `library` - Library management
- `playlists` - Playlist functionality
- `podcasts` - Podcast parsing and playback
- `explore` - Browse and discovery feeds
- `lyrics` - Lyrics display
- `downloads` - Download functionality
- `auth` - Authentication & user accounts
- `settings` - Settings/preferences
- `theme` - Theming system

---

## Code of Conduct

- Be respectful and inclusive
- Welcome newcomers and help them learn
- Focus on constructive feedback
- Respect different viewpoints and experiences

Thank you for contributing to Echoes!
