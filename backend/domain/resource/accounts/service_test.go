package accounts

import (
	"errors"
	"testing"
)

type stubRepository struct {
	items         map[string]*ProviderAccount
	next          int
	hasReferences bool
}

type stubCredentialValidator struct {
	err           error
	lastID        string
	lastActorID   string
	validateCalls int
}

func newStubRepository() *stubRepository {
	return &stubRepository{items: map[string]*ProviderAccount{}}
}

func (r *stubRepository) List() ([]*ProviderAccount, error) {
	result := make([]*ProviderAccount, 0, len(r.items))
	for _, item := range r.items {
		result = append(result, RestoreProviderAccount(item.Snapshot()))
	}
	return result, nil
}

func (r *stubRepository) Get(id string) (*ProviderAccount, error) {
	item, ok := r.items[id]
	if !ok {
		return nil, &NotFoundError{ID: id}
	}
	return RestoreProviderAccount(item.Snapshot()), nil
}

func (r *stubRepository) New() (*ProviderAccount, error) {
	return NewProviderAccount(), nil
}

func (r *stubRepository) ExistsByName(name string, excludeID string) (bool, error) {
	for _, item := range r.items {
		if item.Name() != name {
			continue
		}
		if excludeID != "" && item.ID() == excludeID {
			continue
		}
		return true, nil
	}
	return false, nil
}

func (r *stubRepository) HasReferences(accountID string) (bool, error) {
	return r.hasReferences, nil
}

func (r *stubRepository) Save(account *ProviderAccount) error {
	if account.id == "" {
		r.next++
		account.id = "provider-account-" + string(rune('0'+r.next))
	}
	r.items[account.id] = RestoreProviderAccount(account.Snapshot())
	return nil
}

func (r *stubRepository) Delete(account *ProviderAccount) error {
	delete(r.items, account.ID())
	return nil
}

func (r *stubRepository) RunInTransaction(run func(Repository) error) error {
	return run(r)
}

func (v *stubCredentialValidator) ValidateCredentialRef(credentialID string, actorID string) error {
	v.validateCalls++
	v.lastID = credentialID
	v.lastActorID = actorID
	return v.err
}

func TestCreateRejectsTemplateKindMismatch(t *testing.T) {
	repo := newStubRepository()
	_, err := Create(repo, SaveInput{
		Name:       "Bad Account",
		Kind:       KindAWS,
		TemplateID: "github-app-installation",
		Identifier: "acct-1",
	})
	if err == nil {
		t.Fatal("expected mismatched template kind to fail")
	}
}

func TestCreateRejectsUnsupportedKind(t *testing.T) {
	repo := newStubRepository()
	_, err := Create(repo, SaveInput{
		Name:       "Bad Kind",
		Kind:       "gitlab",
		Identifier: "acct-1",
	})
	if err == nil {
		t.Fatal("expected unsupported kind to fail")
	}
}

func TestCreateRejectsMissingIdentifier(t *testing.T) {
	repo := newStubRepository()
	_, err := Create(repo, SaveInput{
		Name: "Primary AWS",
		Kind: KindAWS,
	})
	if err == nil {
		t.Fatal("expected missing identifier to fail")
	}
	var validationErr *ValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestCreateRejectsDuplicateName(t *testing.T) {
	repo := newStubRepository()
	_, err := Create(repo, SaveInput{Name: "Primary AWS", Kind: KindAWS, TemplateID: "generic-aws-account", Identifier: "acct-1"})
	if err != nil {
		t.Fatal(err)
	}
	_, err = Create(repo, SaveInput{Name: "Primary AWS", Kind: KindGitHub, TemplateID: "github-app-installation", Identifier: "acct-2"})
	if err == nil {
		t.Fatal("expected duplicate name to fail")
	}
	var conflictErr *ConflictError
	if !errors.As(err, &conflictErr) {
		t.Fatalf("expected duplicate-name error, got %v", err)
	}
}

func TestCreateValidatesCredentialReference(t *testing.T) {
	repo := newStubRepository()
	validator := &stubCredentialValidator{}
	_, err := CreateWithDeps(repo, SaveInput{
		Name:         "Primary AWS",
		Kind:         KindAWS,
		TemplateID:   "generic-aws-account",
		Identifier:   "acct-1",
		CredentialID: "secret-1",
	}, SaveDeps{
		ActorID:                "user-1",
		CredentialRefValidator: validator,
	})
	if err != nil {
		t.Fatal(err)
	}
	if validator.validateCalls != 1 {
		t.Fatalf("expected one credential validation call, got %d", validator.validateCalls)
	}
	if validator.lastID != "secret-1" || validator.lastActorID != "user-1" {
		t.Fatalf("unexpected validator input: id=%q actor=%q", validator.lastID, validator.lastActorID)
	}
}

func TestCreateRejectsCredentialWithoutValidator(t *testing.T) {
	repo := newStubRepository()
	_, err := Create(repo, SaveInput{
		Name:         "Primary AWS",
		Kind:         KindAWS,
		TemplateID:   "generic-aws-account",
		Identifier:   "acct-1",
		CredentialID: "secret-1",
	})
	if err == nil {
		t.Fatal("expected missing credential validator to fail")
	}
	var validationErr *ValidationError
	if !errors.As(err, &validationErr) {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestDeleteRejectsReferencedAccount(t *testing.T) {
	repo := newStubRepository()
	item, err := Create(repo, SaveInput{
		Name:       "Primary AWS",
		Kind:       KindAWS,
		TemplateID: "generic-aws-account",
		Identifier: "acct-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	repo.hasReferences = true
	err = DeleteExisting(repo, item)
	if err == nil {
		t.Fatal("expected referenced account deletion to fail")
	}
	var referencedErr *ReferencedByResourcesError
	if !errors.As(err, &referencedErr) {
		t.Fatalf("expected referenced-by-resources error, got %v", err)
	}
}

func TestTemplatesCoverAllProviderAccountKinds(t *testing.T) {
	counts := map[string]int{}
	templates, err := Templates()
	if err != nil {
		t.Fatal(err)
	}
	for _, template := range templates {
		counts[template.Kind]++
	}

	for _, kind := range []string{
		KindAWS,
		KindAliyun,
		KindAzure,
		KindGCP,
		KindGitHub,
		KindCloudflare,
	} {
		if counts[kind] == 0 {
			t.Fatalf("expected at least one template for kind %q", kind)
		}
	}
}
